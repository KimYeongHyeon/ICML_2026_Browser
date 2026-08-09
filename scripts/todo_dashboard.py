#!/usr/bin/env python3
"""Build and optionally serve a self-contained dashboard from Markdown todo files."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


CHECKBOX_RE = re.compile(r"^- \[([ xX])\]\s+(.+?)\s*$")
HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
INLINE_CODE_RE = re.compile(r"`([^`]+)`")
INLINE_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
JSON_SCRIPT_RE = re.compile(
    r'<script\s+id="([^"]+)"\s+type="application/json">(.*?)</script>', re.DOTALL
)
BLOCKER_TERMS = ("[blocker]", "blocked", "blocker", "canonical nas", "p0/p1", " p1", "차단")


@dataclass(frozen=True)
class TodoSpec:
    label: str
    path: Path


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def render_inline(value: str) -> str:
    rendered = html.escape(value, quote=True)
    rendered = INLINE_CODE_RE.sub(r"<code>\1</code>", rendered)
    rendered = INLINE_BOLD_RE.sub(r"<strong>\1</strong>", rendered)
    return rendered


def parse_todo(spec: TodoSpec) -> dict[str, Any]:
    if not spec.path.is_file():
        raise FileNotFoundError(f"todo source does not exist: {spec.path}")

    title = spec.path.stem
    current_section: dict[str, Any] | None = None
    sections: list[dict[str, Any]] = []
    for raw_line in spec.path.read_text(encoding="utf-8").splitlines():
        heading = HEADING_RE.match(raw_line)
        if heading:
            level = len(heading.group(1))
            heading_text = heading.group(2).strip()
            if level == 1:
                title = heading_text
            else:
                current_section = {
                    "title": heading_text,
                    "level": level,
                    "tasks": [],
                }
                sections.append(current_section)
            continue

        checkbox = CHECKBOX_RE.match(raw_line)
        if not checkbox:
            continue
        if current_section is None:
            current_section = {"title": "Other", "level": 2, "tasks": []}
            sections.append(current_section)
        current_section["tasks"].append(
            {"done": checkbox.group(1).lower() == "x", "text": checkbox.group(2).strip()}
        )

    sections = [section for section in sections if section["tasks"]]
    tasks = [task for section in sections for task in section["tasks"]]
    done = sum(task["done"] for task in tasks)
    return {
        "label": spec.label,
        "file": spec.path.name,
        "title": title,
        "updated_at": datetime.fromtimestamp(spec.path.stat().st_mtime).astimezone().isoformat(
            timespec="seconds"
        ),
        "done": done,
        "total": len(tasks),
        "sections": sections,
    }


def is_named_blocker(text: str) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in BLOCKER_TERMS)


def section_unit(source: dict[str, Any], section: dict[str, Any], index: int) -> dict[str, Any]:
    tasks = section["tasks"]
    done_tasks = [task for task in tasks if task["done"]]
    open_tasks = [task for task in tasks if not task["done"]]
    blockers = [task["text"] for task in open_tasks if is_named_blocker(task["text"])]
    if not open_tasks:
        status = "완료"
    elif blockers and done_tasks:
        status = "차단"
    elif done_tasks:
        status = "진행 중"
    else:
        status = "예정"

    evidence = [task["text"] for task in done_tasks[-3:]]
    next_gate = open_tasks[0]["text"] if open_tasks else "이 section의 모든 todo 항목이 검증되었습니다."
    return {
        "id": f"unit-{index}",
        "title": section["title"],
        "subtitle": f"{source['label']} todo",
        "status": status,
        "summary": f"{len(done_tasks)}/{len(tasks)}개 항목이 검증되었습니다.",
        "completion": {"done": len(done_tasks), "total": len(tasks), "label": "완료"},
        "evidence": evidence,
        "next_gate": next_gate,
        "blockers": blockers[:3],
        "technical_ids": [source["file"], section["title"]],
    }


def first_active_section(source: dict[str, Any]) -> dict[str, Any] | None:
    partial = []
    pending = []
    for section in source["sections"]:
        total = len(section["tasks"])
        done = sum(task["done"] for task in section["tasks"])
        if 0 < done < total:
            partial.append(section)
        elif done == 0 and total:
            pending.append(section)
    return (partial or pending or [None])[0]


def source_summary(source: dict[str, Any]) -> str:
    return f"{source['label']} {source['done']}/{source['total']}"


def public_snapshot(sources: list[dict[str, Any]], primary_label: str) -> dict[str, Any]:
    return {
        "generated_at": now_iso(),
        "primary": primary_label,
        "sources": [
            {
                "label": source["label"],
                "file": source["file"],
                "title": source["title"],
                "updated_at": source["updated_at"],
                "done": source["done"],
                "total": source["total"],
                "sections": source["sections"],
            }
            for source in sources
        ],
    }


def replace_json_script(document: str, element_id: str, value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )
    pattern = re.compile(
        rf'(<script\s+id="{re.escape(element_id)}"\s+type="application/json">).*?(</script>)',
        re.DOTALL,
    )
    document, count = pattern.subn(rf"\1{payload}\2", document, count=1)
    if count != 1:
        raise ValueError(f"template is missing JSON block #{element_id}")
    return document


def replace_once(document: str, old: str, new: str, label: str) -> str:
    if old not in document:
        raise ValueError(f"template replacement target not found: {label}")
    return document.replace(old, new, 1)


def todo_toolbar_markup(sources: list[dict[str, Any]], primary_label: str) -> str:
    options = "".join(
        f'<option value="{html.escape(source["label"], quote=True)}"'
        f'{" selected" if source["label"] == primary_label else ""}>'
        f'{html.escape(source["label"])} · {source["done"]}/{source["total"]}</option>'
        for source in sources
    )
    return f"""
      <div class="todo-toolbar card" aria-label="Todo 표시 범위">
        <label><span>목록</span><select id="todoSourceSelect">{options}</select></label>
        <div class="chips" id="todoStatusFilter" aria-label="Todo 상태">
          <button class="chip is-active" type="button" aria-pressed="true" data-status="all">전체</button>
          <button class="chip" type="button" aria-pressed="false" data-status="open">남음</button>
          <button class="chip" type="button" aria-pressed="false" data-status="done">완료</button>
        </div>
      </div>
"""


def todo_detail_markup(sources: list[dict[str, Any]], primary_label: str) -> str:
    source_views = []
    for source in sources:
        active = first_active_section(source)
        section_views = []
        for section in source["sections"]:
            tasks = section["tasks"]
            done = sum(task["done"] for task in tasks)
            rows = "".join(
                '<li class="todo-row{done_class}" data-done="{done_value}">'
                '<span class="todo-mark" aria-hidden="true">{mark}</span>'
                '<span>{text}</span></li>'.format(
                    done_class=" done" if task["done"] else "",
                    done_value="true" if task["done"] else "false",
                    mark="✓" if task["done"] else "•",
                    text=render_inline(task["text"]),
                )
                for task in tasks
            )
            section_views.append(
                '<details class="todo-group"{open_attr}>'
                '<summary><span>{title}</span><span class="num">{done}/{total}</span></summary>'
                '<ul>{rows}</ul></details>'.format(
                    open_attr=" open" if section is active else "",
                    title=html.escape(section["title"]),
                    done=done,
                    total=len(tasks),
                    rows=rows,
                )
            )
        source_views.append(
            '<div class="todo-source" data-source="{label}"{hidden}>{sections}</div>'.format(
                label=html.escape(source["label"], quote=True),
                hidden="" if source["label"] == primary_label else " hidden",
                sections="".join(section_views),
            )
        )

    return f"""
    <section id="todoItemsSection">
      <h2>Todo 항목</h2>
      <div id="todoSources">{''.join(source_views)}</div>
    </section>
"""


def build_dashboard(
    template_path: Path,
    output_path: Path,
    specs: list[TodoSpec],
    primary_label: str,
    refresh_seconds: int,
) -> dict[str, Any]:
    sources = [parse_todo(spec) for spec in specs]
    by_label = {source["label"]: source for source in sources}
    if primary_label not in by_label:
        raise ValueError(f"primary todo label not found: {primary_label}")
    primary = by_label[primary_label]
    if primary["total"] <= 0:
        raise ValueError("primary todo has no checkbox items")

    generated_at = now_iso()
    percent = 100.0 * primary["done"] / primary["total"]
    active = first_active_section(primary)
    active_title = active["title"] if active else "모든 항목 완료"
    active_tasks = active["tasks"] if active else []
    active_done = sum(task["done"] for task in active_tasks)
    active_open = [task["text"] for task in active_tasks if not task["done"]]
    named_blockers = [task for task in active_open if is_named_blocker(task)]
    units = [section_unit(primary, section, index) for index, section in enumerate(primary["sections"])]

    framing = [
        {
            "title": "목표",
            "text": "선택한 논문에서 다음 읽을 논문을 빠르고 신뢰 있게 결정하도록 관련연구 기능을 구축합니다.",
        },
        {
            "title": "현재 범위",
            "text": "stale artifact 안전장치부터 Work/Appearance, HDBSCAN, top-20 shard, 제품 UX, citation shadow mode까지 순서대로 진행합니다.",
        },
        {
            "title": "현재 상태",
            "text": f"{primary['done']}/{primary['total']}개 구현 항목이 검증되었습니다. 현재 {active_title}을 진행 중입니다.",
        },
        {
            "title": "데이터 원본",
            "text": " · ".join(source_summary(source) for source in sources),
        },
    ]

    template = template_path.read_text(encoding="utf-8")
    document = template
    document = replace_once(document, "<title>Results dashboard — template</title>", "<title>관련연구 매칭 진행 현황</title>", "title")
    document = replace_once(
        document,
        "<title>관련연구 매칭 진행 현황</title>",
        '<title>관련연구 매칭 진행 현황</title>\n<meta name="description" content="Todo 체크박스에서 생성한 관련연구 매칭 진행 대시보드">\n<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ctext y=\'.9em\' font-size=\'90\'%3E✓%3C/text%3E%3C/svg%3E">',
        "metadata",
    )
    document = replace_once(document, '<div class="eyebrow">EYEBROW · CONTEXT</div>', '<div class="eyebrow">TODO · LIVE STATUS</div>', "eyebrow")
    document = replace_once(document, '<h1>Dashboard title — the question it answers</h1>', '<h1>관련연구 매칭 진행 현황</h1>', "heading")
    document = replace_once(
        document,
        '<p class="lede">One sentence on scope, n, setup — what was compared and how the metrics were computed.</p>',
        '<p class="lede">구현·감시·총괄 todo의 실제 체크박스를 기준으로 진행 상태와 다음 완료 조건을 보여줍니다.</p>',
        "lede",
    )
    document = replace_once(
        document,
        '<span><span class="dot"></span>Updated YYYY-MM-DD · run/config id</span>\n        <span>metric definitions verified against the source report</span>',
        f'<span><span class="dot"></span>업데이트 {html.escape(generated_at)}</span>\n        <span>서버에서 {refresh_seconds}초마다 자동 새로고침</span>',
        "header metadata",
    )
    document = replace_once(
        document,
        '<button class="toggle" id="themeBtn" data-copy="theme">◐ Theme</button>',
        '<div class="header-actions"><button class="navbtn" id="refreshBtn" type="button">↻ 새로고침</button><button class="toggle" id="themeBtn" data-copy="theme">◐ 테마</button></div>',
        "header actions",
    )
    verdict_title = f"전체 구현 {percent:.1f}% — {active_title}"
    blocker_copy = named_blockers[0] if named_blockers else (active_open[0] if active_open else "남은 항목이 없습니다.")
    document = replace_once(document, "<h3>Headline finding, stated plainly</h3>", f"<h3>{html.escape(verdict_title)}</h3>", "verdict title")
    document = replace_once(
        document,
        '<p>One honest paragraph — include a null/negative result if that is the truth. If variants overlap, say "near-identical" here rather than zooming an axis to fake a gap.</p>',
        f'<p>{primary["done"]}/{primary["total"]}개 항목이 검증되었습니다. 현재 완료 조건: {render_inline(blocker_copy)}</p>',
        "verdict text",
    )
    if named_blockers:
        document = document.replace('<div class="verdict" id="verdict">', '<div class="verdict warn" id="verdict">', 1)

    document = replace_json_script(document, "framingdata", framing)
    document = replace_json_script(document, "unitdata", units)
    document = replace_json_script(document, "data", [])
    document = replace_json_script(document, "imgdata", {})
    document = replace_json_script(document, "plandata", [])
    document = replace_json_script(document, "notesdata", [])
    document = replace_json_script(document, "issuesdata", [])

    snapshot = public_snapshot(sources, primary_label)
    snapshot["generated_at"] = generated_at
    snapshot_payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    document = replace_once(
        document,
        "<script>\n/* ===== CONFIG — edit these ===== */",
        f'<script id="todosnapshot" type="application/json">{snapshot_payload}</script>\n<script>\n/* ===== CONFIG — edit these ===== */',
        "todo snapshot",
    )

    tile_block = """const TILES=[
  ()=>({v:'__PERCENT__%',lab:'전체 구현 진행률'}),
  ()=>({v:'__DONE__ / __TOTAL__',lab:'검증된 구현 항목',cls:'good'}),
  ()=>({v:'__ACTIVE_DONE__ / __ACTIVE_TOTAL__',lab:'현재 Milestone'}),
  ()=>({v:'__OPEN__',lab:'남은 구현 항목',cls:'alert'}),
];
/* ================================""".replace("__PERCENT__", f"{percent:.1f}").replace("__DONE__", str(primary["done"])).replace("__TOTAL__", str(primary["total"])).replace("__ACTIVE_DONE__", str(active_done)).replace("__ACTIVE_TOTAL__", str(len(active_tasks))).replace("__OPEN__", str(primary["total"] - primary["done"]))
    document, tile_count = re.subn(
        r"const TILES=\[.*?\n\];\n/\* ================================",
        tile_block,
        document,
        count=1,
        flags=re.DOTALL,
    )
    if tile_count != 1:
        raise ValueError("template TILES block was not replaced")
    document = replace_once(
        document,
        "if(HAS_NUMERIC)document.getElementById('tiles').innerHTML=TILES.map",
        "document.getElementById('tiles').innerHTML=TILES.map",
        "static progress tiles",
    )
    document = replace_once(
        document,
        "if(!HAS_NUMERIC){document.getElementById('tilesSection').hidden=true;document.getElementById('summarySection').hidden=true;document.getElementById('countNote').textContent=COPY.empty.numeric;}",
        "if(!HAS_NUMERIC){document.getElementById('summarySection').hidden=true;document.getElementById('countNote').textContent=COPY.empty.numeric;}",
        "unit-only overview",
    )

    document = document.replace("locale:'en-US'", "locale:'ko-KR'", 1)
    document = document.replace("groups:{results:'Results',record:'Record',build:'Build'}", "groups:{results:'진행',record:'기록',build:'구성'}", 1)
    document = document.replace("tabs:{overview:'Overview',detail:'Per-item',samples:'Samples',plan:'Plan',notes:'Notes',issues:'Issues',components:'Components'}", "tabs:{overview:'개요',detail:'Milestone',samples:'샘플',plan:'계획',notes:'노트',issues:'이슈',components:'구성'}", 1)
    document = document.replace("sections:{overview:'Overview',glance:'At a glance',summary:'Summary',findings:'Findings',units:'Units'", "sections:{overview:'프로젝트',glance:'전체 현황',summary:'요약',findings:'현재 판단',units:'Milestone'", 1)
    document = document.replace("controls:{theme:'◐ Theme'", "controls:{theme:'◐ 테마'", 1)
    document = document.replace("labels:{evidence:'Evidence',blockers:'Blockers',nextGate:'Next gate',technicalIds:'Technical IDs',completion:'completion'}", "labels:{evidence:'검증 근거',blockers:'차단 요인',nextGate:'다음 완료 조건',technicalIds:'출처',completion:'완료'}", 1)
    document = document.replace("emptyBlockers:'No named blockers.'", "emptyBlockers:'확인된 차단 요인이 없습니다.'", 1)
    document = document.replace("unitHelp:'Role, current judgment, evidence stage, blockers, and the next completion gate for each unit.'", "unitHelp:'각 Milestone의 검증된 항목, 차단 요인, 다음 완료 조건입니다.'", 1)

    findings_start = document.index('    <section>\n      <h2 data-copy-section="findings">')
    findings_end = document.index("    </section>", findings_start) + len("    </section>")
    blocker_items = named_blockers[:2] or ([blocker_copy] if blocker_copy else [])
    blockers_html = "<br>".join(render_inline(item) for item in blocker_items)
    next_action = active_open[0] if active_open else "남은 작업이 없습니다."
    findings = f"""    <section>
      <h2 data-copy-section="findings">현재 판단</h2>
      <div class="callouts">
        <div class="callout"><h3>현재 작업</h3><p>{html.escape(active_title)} · {active_done}/{len(active_tasks)} 완료</p></div>
        <div class="callout warn"><h3>차단 요인</h3><p>{blockers_html}</p></div>
        <div class="callout"><h3>다음 행동</h3><p>{render_inline(next_action)}</p></div>
      </div>
    </section>"""
    document = document[:findings_start] + findings + document[findings_end:]

    unit_grid_marker = '      <div class="unit-grid" id="unitGrid"></div>'
    document = replace_once(
        document,
        unit_grid_marker,
        todo_toolbar_markup(sources, primary_label) + unit_grid_marker,
        "todo toolbar before milestone cards",
    )

    detail_marker = "    </section>\n\n    <section data-numeric-detail>"
    document = replace_once(
        document,
        detail_marker,
        "    </section>\n" + todo_detail_markup(sources, primary_label) + "\n    <section data-numeric-detail>",
        "todo detail section",
    )

    build_group_pattern = re.compile(
        r'\s*<span class="tabgroup" role="presentation" data-glabel="Build".*?</span>',
        re.DOTALL,
    )
    document, build_group_count = build_group_pattern.subn("", document, count=1)
    if build_group_count != 1:
        raise ValueError("template Components tab group was not removed")
    kit_start = document.index("  <!-- ===== COMPONENTS")
    kit_end = document.index('  <footer id="footer">', kit_start)
    document = document[:kit_start] + document[kit_end:]
    document = replace_once(
        document,
        "document.getElementById('kitSwatches').innerHTML=['--accent'",
        "const kitSwatches=document.getElementById('kitSwatches');if(kitSwatches)kitSwatches.innerHTML=['--accent'",
        "removed Components guard",
    )
    document = document.replace(
        "Compiled YYYY-MM-DD · numbers re-checked against the source report · treat any unverified figure as provisional.",
        f"생성 {generated_at} · 체크박스가 검증된 항목만 완료로 계산됩니다.",
        1,
    )

    extra_css = """
  .header-actions{display:flex;gap:8px;align-items:center}
  .tabgroup[hidden]{display:none}
  .todo-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;margin-bottom:12px}
  .todo-toolbar label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px;font-weight:650}
  .todo-toolbar select{border:1px solid var(--border-strong);background:var(--surface);color:var(--ink);border-radius:8px;padding:7px 10px;font:inherit}
  .todo-source[hidden]{display:none}
  .todo-group{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:10px;overflow:hidden}
  .todo-group summary{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:13px 15px;cursor:pointer;font-weight:680;color:var(--ink);background:var(--surface-2)}
  .todo-group ul{list-style:none;margin:0;padding:0}
  .todo-row{display:grid;grid-template-columns:22px 1fr;gap:8px;padding:10px 15px;border-top:1px solid var(--border);font-size:14px;align-items:start}
  .todo-row.done{color:var(--muted)}
  .todo-mark{font-family:var(--font-mono);font-weight:800;color:var(--warn)}
  .todo-row.done .todo-mark{color:var(--ok)}
  .todo-row[hidden]{display:none}
  .unit-card,.unit-card>*,.todo-row>span{min-width:0}
  .unit-tech code{display:block;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
  .todo-row code,.todo-row .inline-code,.unit-card .inline-code{white-space:normal;overflow-wrap:anywhere;word-break:break-word}
  .todo-toolbar .chip.is-active{background:var(--accent);border-color:var(--accent);color:#06232a;font-weight:700}
  @media(max-width:640px){.todo-toolbar{align-items:stretch}.todo-toolbar label{justify-content:space-between}.todo-toolbar select{min-width:0;max-width:70vw}.todo-row{padding:10px 12px}}
"""
    document = replace_once(document, "</style>", extra_css + "</style>", "dashboard CSS")

    extra_js = f"""
/* Todo dashboard interaction and live refresh. */
(function(){{
  const select=document.getElementById('todoSourceSelect');
  const filter=document.getElementById('todoStatusFilter');
  const key='todo-dashboard-ui';
  let status='all';
  try{{const saved=JSON.parse(sessionStorage.getItem(key)||'{{}}');if(saved.source)select.value=saved.source;if(saved.status)status=saved.status;}}
  catch(_error){{}}
  function apply(){{
    document.querySelectorAll('.todo-source').forEach(el=>el.hidden=el.dataset.source!==select.value);
    document.querySelectorAll('.todo-row').forEach(row=>{{const done=row.dataset.done==='true';row.hidden=status==='done'&&!done||status==='open'&&done;}});
    filter.querySelectorAll('.chip').forEach(btn=>{{const selected=btn.dataset.status===status;btn.classList.toggle('is-active',selected);btn.setAttribute('aria-pressed',selected?'true':'false');}});
    sessionStorage.setItem(key,JSON.stringify({{source:select.value,status}}));
  }}
  select.addEventListener('change',apply);
  filter.addEventListener('click',event=>{{const button=event.target.closest('[data-status]');if(!button)return;status=button.dataset.status;apply();}});
  document.getElementById('refreshBtn').addEventListener('click',()=>location.reload());
  document.querySelectorAll('.tabgroup').forEach(group=>{{const visible=[...group.querySelectorAll('button')].some(button=>!button.hidden&&button.style.display!=='none');group.hidden=!visible;}});
  const priorTheme=localStorage.getItem('todo-dashboard-theme');if(priorTheme)document.documentElement.setAttribute('data-theme',priorTheme);
  document.getElementById('themeBtn').addEventListener('click',()=>localStorage.setItem('todo-dashboard-theme',document.documentElement.getAttribute('data-theme')||''));
  apply();
  if(location.protocol==='http:'||location.protocol==='https:'){{
    addEventListener('beforeunload',()=>sessionStorage.setItem('todo-dashboard-scroll',String(scrollY)));
    const savedScroll=Number(sessionStorage.getItem('todo-dashboard-scroll')||0);if(savedScroll)requestAnimationFrame(()=>scrollTo(0,savedScroll));
    setTimeout(()=>{{if(document.visibilityState==='visible')location.reload();}}, {max(5, refresh_seconds) * 1000});
  }}
}})();
"""
    closing_script = document.rfind("</script>")
    if closing_script < 0:
        raise ValueError("template closing script not found")
    document = document[:closing_script] + extra_js + document[closing_script:]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    temp_path.write_text(document, encoding="utf-8")
    temp_path.replace(output_path)
    validate_dashboard(output_path, primary["done"], primary["total"])
    return {
        "generated_at": generated_at,
        "output": str(output_path.resolve()),
        "done": primary["done"],
        "total": primary["total"],
        "percent": round(percent, 1),
        "active_section": active_title,
        "sources": {source["label"]: {"done": source["done"], "total": source["total"]} for source in sources},
    }


def validate_dashboard(path: Path, expected_done: int, expected_total: int) -> None:
    document = path.read_text(encoding="utf-8")
    if "__PLACEHOLDER__" in document:
        raise ValueError("dashboard contains a placeholder marker")
    if "pane-kit" in document or 'data-copy-tab="components"' in document:
        raise ValueError("dashboard still contains the build-only Components pane")
    blocks = {element_id: json.loads(payload) for element_id, payload in JSON_SCRIPT_RE.findall(document)}
    required = {"framingdata", "unitdata", "data", "imgdata", "plandata", "notesdata", "issuesdata", "todosnapshot"}
    missing = required - blocks.keys()
    if missing:
        raise ValueError(f"dashboard is missing JSON blocks: {sorted(missing)}")
    snapshot = blocks["todosnapshot"]
    primary = next(source for source in snapshot["sources"] if source["label"] == snapshot["primary"])
    if (primary["done"], primary["total"]) != (expected_done, expected_total):
        raise ValueError("embedded dashboard totals do not match the parsed primary todo")
    if not blocks["unitdata"]:
        raise ValueError("dashboard has no milestone detail units")


class StatusWriter:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, event: str, **fields: Any) -> None:
        record = {"timestamp": now_iso(), "event": event, **fields}
        with self.lock, self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def git_status(cwd: Path) -> list[str]:
    result = subprocess.run(
        ["git", "status", "--short"],
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return result.stdout.splitlines()


def write_runtime_metadata(
    path: Path,
    args: argparse.Namespace,
    specs: list[TodoSpec],
    cwd: Path,
) -> None:
    metadata = {
        "start_timestamp": now_iso(),
        "pid": os.getpid(),
        "working_directory": str(cwd),
        "command": [sys.executable, *sys.argv],
        "git_status": git_status(cwd),
        "seed": None,
        "config": {
            "host": args.host,
            "port": args.port,
            "refresh_seconds": args.refresh_seconds,
            "primary": args.primary,
            "todo_sources": [{"label": spec.label, "path": str(spec.path)} for spec in specs],
        },
        "supervisor": {"type": "tmux" if args.session_name else "process", "session_name": args.session_name},
        "stdout_log": args.stdout_log,
        "stderr_log": args.stderr_log,
        "progress_log": str(args.runtime_dir / "progress.jsonl"),
        "expected_artifacts": [str(args.output.resolve()), str((args.runtime_dir / "run.json").resolve())],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def serve(args: argparse.Namespace, specs: list[TodoSpec], template_path: Path) -> None:
    cwd = Path.cwd()
    runtime_dir = args.runtime_dir.resolve()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    status = StatusWriter(runtime_dir / "progress.jsonl")
    write_runtime_metadata(runtime_dir / "run.json", args, specs, cwd)

    latest = build_dashboard(template_path, args.output, specs, args.primary, args.refresh_seconds)
    status.write("server_started", pid=os.getpid(), url=f"http://{args.host}:{args.port}/", **latest)

    class Handler(BaseHTTPRequestHandler):
        server_version = "TodoDashboard/1.0"

        def log_message(self, fmt: str, *values: Any) -> None:
            print(f"{self.address_string()} - {fmt % values}", flush=True)

        def send_bytes(self, payload: bytes, content_type: str, code: HTTPStatus = HTTPStatus.OK) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
            route = urlparse(self.path).path
            if route == "/healthz":
                payload = json.dumps({"status": "ok", "timestamp": now_iso(), "pid": os.getpid()}, ensure_ascii=False).encode("utf-8")
                self.send_bytes(payload, "application/json; charset=utf-8")
                return
            if route not in ("/", "/todo-dashboard.html"):
                self.send_bytes(b"not found\n", "text/plain; charset=utf-8", HTTPStatus.NOT_FOUND)
                return
            try:
                snapshot = build_dashboard(template_path, args.output, specs, args.primary, args.refresh_seconds)
                payload = args.output.read_bytes()
                status.write("dashboard_served", client=self.client_address[0], **snapshot)
                self.send_bytes(payload, "text/html; charset=utf-8")
            except Exception as error:  # fail visibly; no fallback snapshot
                status.write("build_failed", error=repr(error))
                self.send_bytes(
                    f"dashboard build failed: {error}\n".encode("utf-8"),
                    "text/plain; charset=utf-8",
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        status.write("server_stopped", pid=os.getpid())
        server.server_close()


def parse_todo_specs(values: list[str], cwd: Path) -> list[TodoSpec]:
    specs = []
    for value in values:
        if "=" in value:
            label, raw_path = value.split("=", 1)
        else:
            raw_path = value
            label = Path(raw_path).stem
        label = label.strip()
        if not label:
            raise ValueError(f"todo label is empty: {value}")
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = (cwd / path).resolve()
        specs.append(TodoSpec(label=label, path=path))
    labels = [spec.label for spec in specs]
    if len(labels) != len(set(labels)):
        raise ValueError("todo labels must be unique")
    return specs


def default_template_path() -> Path:
    configured = os.environ.get("TODO_DASHBOARD_TEMPLATE")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex" / "skills" / "dashboard" / "assets" / "template.html"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--todo", action="append", required=True, metavar="LABEL=PATH")
    parser.add_argument("--primary", required=True, help="label used for the overall percentage")
    parser.add_argument("--template", type=Path, default=default_template_path())
    parser.add_argument("--output", type=Path, default=Path("runs/todo-dashboard/dashboard.html"))
    parser.add_argument("--refresh-seconds", type=int, default=15)
    parser.add_argument("--check", action="store_true", help="validate the generated HTML and exit")
    parser.add_argument("--serve", action="store_true", help="serve and rebuild the dashboard on each request")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--runtime-dir", type=Path, default=Path("runs/todo-dashboard/runtime"))
    parser.add_argument("--session-name", default="")
    parser.add_argument("--stdout-log", default="")
    parser.add_argument("--stderr-log", default="")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    cwd = Path.cwd()
    specs = parse_todo_specs(args.todo, cwd)
    args.template = args.template.expanduser().resolve()
    args.output = args.output.expanduser().resolve()
    args.runtime_dir = args.runtime_dir.expanduser().resolve()
    if not args.template.is_file():
        parser.error(f"dashboard template not found: {args.template}")
    if args.refresh_seconds < 5:
        parser.error("--refresh-seconds must be at least 5")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    if args.serve:
        serve(args, specs, args.template)
        return 0

    snapshot = build_dashboard(args.template, args.output, specs, args.primary, args.refresh_seconds)
    if args.check:
        print(json.dumps({"status": "ok", **snapshot}, ensure_ascii=False))
    else:
        print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
