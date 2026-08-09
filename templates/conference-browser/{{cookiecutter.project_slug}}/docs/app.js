const searchInput = document.querySelector("#search");
const statusSelect = document.querySelector("#status");
const recordsElement = document.querySelector("#records");
const resultsPanel = document.querySelector(".results-panel");
const resultCount = document.querySelector("#result-count");
const summaryElement = document.querySelector("#summary");
const siteTitle = document.querySelector("#site-title");
const emptyTemplate = document.querySelector("#empty-template");
const loadMoreButton = document.querySelector("#load-more");
const viewerPanel = document.querySelector("#viewer-panel");
const viewerKind = document.querySelector("#viewer-kind");
const viewerTitle = document.querySelector("#viewer-title");
const viewerActions = document.querySelector("#viewer-actions");
const viewerMeta = document.querySelector("#viewer-meta");
const viewerFrame = document.querySelector("#viewer-frame");

const PAGE_SIZE = 120;
const NON_EMBEDDABLE_PDF_HOSTS = Object.freeze([
  "openreview.net",
  "docs.google.com",
  "drive.google.com",
]);
const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "credential",
  "password",
  "secret",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-signature",
]);
const MATH_SYMBOLS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ϵ",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  cdot: "·",
  times: "×",
  pm: "±",
  leq: "≤",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  sum: "∑",
  prod: "∏",
  ell: "ℓ",
  infty: "∞",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
});
const BLACKBOARD_SYMBOLS = Object.freeze({
  C: "ℂ",
  N: "ℕ",
  Q: "ℚ",
  R: "ℝ",
  Z: "ℤ",
});
const CALLIGRAPHIC_SYMBOLS = Object.freeze({
  H: "ℋ",
  L: "ℒ",
  O: "𝒪",
});
const SUPERSCRIPT_SYMBOLS = Object.freeze({
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  i: "ⁱ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  n: "ⁿ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
});

let records = [];
let conference = null;
let visibleCount = PAGE_SIZE;
let selectedId = "";
let renderedViewerId = null;

function superscript(value) {
  const converted = [...value].map((character) => SUPERSCRIPT_SYMBOLS[character]);
  return converted.every(Boolean) ? converted.join("") : `^(${value})`;
}

function normalizeMath(expression) {
  let output = expression;
  output = output.replace(
    /\\mathbb\{([A-Za-z])\}/g,
    (_match, character) => BLACKBOARD_SYMBOLS[character] || character,
  );
  output = output.replace(
    /\\mathcal\{([A-Za-z])\}/g,
    (_match, character) => CALLIGRAPHIC_SYMBOLS[character] || character,
  );
  output = output.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");
  output = output.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  output = output.replace(
    /\\(?:mathbf|mathrm|mathit|mathsf|mathtt|textbf|textit|text|emph|operatorname)\{([^{}]*)\}/g,
    "$1",
  );
  output = output.replace(/\^\{([^{}]+)\}/g, (_match, value) => superscript(value));
  output = output.replace(/_\{([^{}]+)\}/g, "₍$1₎");
  output = output.replace(
    /\\([A-Za-z]+)/g,
    (_match, command) => MATH_SYMBOLS[command] || command,
  );
  return output
    .replace(/\\[,;:!]/g, " ")
    .replace(/\\_/g, "_")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readableTitle(title) {
  return title
    .replace(/\$\$([^$]+)\$\$/g, (_match, expression) => normalizeMath(expression))
    .replace(/\$([^$]+)\$/g, (_match, expression) => normalizeMath(expression))
    .replace(/\\\((.*?)\\\)/g, (_match, expression) => normalizeMath(expression))
    .replace(/\\\[(.*?)\\\]/g, (_match, expression) => normalizeMath(expression))
    .replace(
      /\\(?:mathbf|mathrm|mathit|mathsf|mathtt|textbf|textit|texttt|textrm|textsc|text|emph|operatorname)\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\^\{([^{}]+)\}/g, (_match, value) => superscript(value))
    .replace(/\^([0-9+\-=()])/g, (_match, value) => superscript(value))
    .replace(/\\([A-Za-z]+)/g, (_match, command) => MATH_SYMBOLS[command] || command)
    .replace(/\\([%_&#])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function publicUrl(value, label, { required = false } = {}) {
  if (!value) {
    if (required) throw new Error(`Missing public URL for ${label}`);
    return null;
  }
  if (typeof value !== "string" || /\s/.test(value)) {
    throw new Error(`Unsafe public URL for ${label}`);
  }
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Unsafe public URL for ${label}`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLocaleLowerCase())) {
      throw new Error(`Credential-bearing public URL for ${label}`);
    }
  }
  return parsed;
}

function publicLink(url, label, className = "") {
  const parsed = publicUrl(url, label);
  if (!parsed) return null;
  const link = createElement("a", className, label);
  link.href = parsed.href;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  return link;
}

function statusKind(record) {
  if (record.accessStatus === "unavailable_public_access") return "unavailable_public_access";
  if (record.archived) return "archived";
  if (record.archiveStatus === "not_started") return "not_started";
  return "other";
}

function statusLabel(record) {
  const kind = statusKind(record);
  if (kind === "archived") return "Archived";
  if (kind === "unavailable_public_access") return "No public PDF";
  if (kind === "not_started") return "Not archived";
  return record.archiveStatus.replaceAll("_", " ");
}

function archiveDateLabel(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function matchesStatus(record, selectedStatus) {
  if (selectedStatus === "all") return true;
  if (selectedStatus === "archived") return record.archived;
  if (selectedStatus === "not_started") return record.archiveStatus === "not_started";
  if (selectedStatus === "unavailable_public_access") {
    return record.accessStatus === "unavailable_public_access";
  }
  return (
    !record.archived
    && record.archiveStatus !== "not_started"
    && record.accessStatus !== "unavailable_public_access"
  );
}

function paperCard(record) {
  const article = createElement("article", "paper-card");
  const isSelected = record.id === selectedId;
  article.classList.toggle("is-selected", isSelected);
  article.dataset.recordId = record.id;

  const selectButton = createElement("button", "paper-select");
  selectButton.type = "button";
  selectButton.dataset.selectRecord = record.id;
  selectButton.setAttribute("aria-controls", "viewer-panel");
  selectButton.setAttribute("aria-pressed", String(isSelected));
  selectButton.setAttribute("aria-label", `View ${record.displayTitle}`);
  selectButton.append(
    createElement("h3", "", record.displayTitle),
    createElement(
      "p",
      "authors",
      record.authors.length ? record.authors.join(", ") : "Authors unavailable",
    ),
  );
  selectButton.addEventListener("click", () => selectRecord(record.id));
  article.append(selectButton);

  const footer = createElement("div", "card-footer");
  footer.append(createElement("span", `status status-${statusKind(record)}`, statusLabel(record)));

  const links = createElement("div", "card-links");
  const sourceLink = publicLink(record.sourceUrl, "Source");
  const pdfLink = publicLink(record.publicPdfUrl, "Public PDF");
  if (sourceLink) links.append(sourceLink);
  if (pdfLink && pdfLink.href !== sourceLink?.href) links.append(pdfLink);
  footer.append(links);
  article.append(footer);
  return article;
}

function resultLabel(count) {
  return `${count.toLocaleString()} ${count === 1 ? "result" : "results"}`;
}

function previewPolicy(pdfUrl) {
  if (window.location.protocol === "https:" && pdfUrl.protocol === "http:") {
    return {
      inline: false,
      reason: "This HTTP PDF cannot be embedded in an HTTPS page. Open it in a new tab instead.",
    };
  }
  const hostname = pdfUrl.hostname.replace(/^www\./, "").toLocaleLowerCase();
  const blocked = NON_EMBEDDABLE_PDF_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
  if (blocked) {
    return {
      inline: false,
      reason: "This PDF host blocks reliable cross-origin embedding. Open the public PDF in a new tab; no private archive path or credentials are proxied.",
    };
  }
  return { inline: true, reason: "" };
}

function renderPdfFallback(stage, pdfUrl, reason) {
  const fallback = createElement("div", "pdf-fallback");
  const illustration = createElement("div", "paper-illustration");
  illustration.setAttribute("aria-hidden", "true");
  const copy = createElement("div", "pdf-fallback-copy");
  copy.append(
    createElement("h3", "", "Public PDF ready"),
    createElement("p", "", reason),
  );
  const openLink = publicLink(pdfUrl.href, "Open PDF", "action primary");
  if (openLink) copy.append(openLink);
  fallback.append(illustration, copy);
  stage.append(fallback);
}

function renderPdfPreview(record) {
  const pdfUrl = publicUrl(record.publicPdfUrl, `${record.id}.publicPdfUrl`);
  if (!pdfUrl) {
    const unavailable = createElement("div", "preview-unavailable");
    unavailable.append(
      createElement("strong", "", "No public PDF is available"),
      createElement(
        "span",
        "",
        record.accessReason || "The archive record has no lawful public PDF URL.",
      ),
    );
    viewerFrame.append(unavailable);
    return;
  }

  const shell = createElement("div", "pdf-shell");
  const toolbar = createElement("div", "pdf-toolbar");
  toolbar.setAttribute("aria-label", "PDF preview controls");
  const toolbarTitle = createElement("span", "pdf-toolbar-title");
  toolbarTitle.append(
    createElement("span", "pdf-badge", "PDF"),
    document.createTextNode("Public preview"),
  );
  const toolbarLink = publicLink(pdfUrl.href, "Open in new tab", "action");
  toolbar.append(toolbarTitle);
  if (toolbarLink) toolbar.append(toolbarLink);

  const stage = createElement("div", "pdf-stage");
  const policy = previewPolicy(pdfUrl);
  if (policy.inline) {
    const frame = createElement("iframe");
    frame.src = pdfUrl.href;
    frame.title = `${record.displayTitle} PDF preview`;
    frame.loading = "eager";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-downloads");
    stage.append(frame);
  } else {
    renderPdfFallback(stage, pdfUrl, policy.reason);
  }
  shell.append(toolbar, stage);
  viewerFrame.append(shell);
}

function renderViewer(record) {
  const nextViewerId = record?.id || "__empty__";
  if (renderedViewerId === nextViewerId) return;
  renderedViewerId = nextViewerId;
  viewerActions.replaceChildren();
  viewerMeta.replaceChildren();
  viewerFrame.replaceChildren();

  if (!record) {
    viewerKind.textContent = "Paper details";
    viewerTitle.textContent = "No matching paper";
    const empty = createElement("div", "viewer-empty");
    empty.append(
      createElement("strong", "", "No record selected"),
      createElement("span", "", "Change the search or archive-state filter to select a paper."),
    );
    viewerFrame.append(empty);
    return;
  }

  viewerKind.textContent = `${conference.name} ${conference.year} paper`;
  viewerTitle.textContent = record.displayTitle;

  const pdfAction = publicLink(record.publicPdfUrl, "Open PDF", "action primary");
  const sourceAction = publicLink(record.sourceUrl, "Source", "action");
  if (pdfAction) viewerActions.append(pdfAction);
  if (sourceAction && sourceAction.href !== pdfAction?.href) viewerActions.append(sourceAction);

  const authors = createElement(
    "span",
    "viewer-meta-line",
    record.authors.length ? record.authors.join(", ") : "Authors unavailable",
  );
  authors.prepend(createElement("b", "", "Authors · "));
  viewerMeta.append(
    authors,
    createElement("span", `status status-${statusKind(record)}`, statusLabel(record)),
  );
  const archiveDate = archiveDateLabel(record.archiveUpdatedAt);
  if (archiveDate) {
    viewerMeta.append(createElement("span", "viewer-meta-line", `Archive checked · ${archiveDate}`));
  }
  renderPdfPreview(record);
}

function filteredRecords() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const selectedStatus = statusSelect.value;
  return records.filter((record) => {
    const matchesQuery = !query || record.searchText.includes(query);
    return matchesQuery && matchesStatus(record, selectedStatus);
  });
}

function render() {
  const filtered = filteredRecords();
  if (!filtered.some((record) => record.id === selectedId)) {
    selectedId = (filtered.find((record) => record.publicPdfUrl) || filtered[0])?.id || "";
  }
  const visible = filtered.slice(0, visibleCount);
  recordsElement.replaceChildren();
  if (!filtered.length) {
    recordsElement.append(emptyTemplate.content.cloneNode(true));
  } else {
    recordsElement.append(...visible.map(paperCard));
  }
  resultCount.textContent = filtered.length > visible.length
    ? `Showing ${visible.length.toLocaleString()} of ${filtered.length.toLocaleString()}`
    : resultLabel(filtered.length);
  loadMoreButton.hidden = visible.length >= filtered.length;
  renderViewer(filtered.find((record) => record.id === selectedId) || null);
}

function selectRecord(recordId) {
  if (selectedId !== recordId) {
    selectedId = recordId;
    renderedViewerId = null;
    render();
  }
  if (window.matchMedia("(max-width: 760px)").matches) {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    viewerPanel.scrollIntoView({ behavior, block: "start" });
  }
}

function validateData(data) {
  if (data?.schemaVersion !== "conference-browser-records/v1" || !Array.isArray(data.records)) {
    throw new Error("Invalid conference data contract");
  }
  if (
    !data.conference
    || typeof data.conference.name !== "string"
    || typeof data.conference.title !== "string"
    || !Number.isInteger(data.conference.year)
    || !data.conference.name
    || !data.conference.title
  ) {
    throw new Error("Invalid conference identity contract");
  }
  if (
    !data.summary
    || !Number.isInteger(data.summary.total)
    || !Number.isInteger(data.summary.archived)
    || !Number.isInteger(data.summary.publicPdf)
    || data.summary.total !== data.records.length
  ) {
    throw new Error("Invalid conference summary contract");
  }
  for (const record of data.records) {
    if (
      !record
      || typeof record.id !== "string"
      || !record.id
      || typeof record.title !== "string"
      || !record.title
      || !Array.isArray(record.authors)
      || record.authors.some((author) => typeof author !== "string")
      || typeof record.archiveStatus !== "string"
      || typeof record.archived !== "boolean"
      || typeof record.accessStatus !== "string"
    ) {
      throw new Error("Invalid public paper record");
    }
    publicUrl(record.sourceUrl, `${record.id}.sourceUrl`, { required: true });
    publicUrl(record.publicPdfUrl, `${record.id}.publicPdfUrl`);
  }
}

async function init() {
  const response = await fetch("data/records.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load conference data (${response.status})`);
  const data = await response.json();
  validateData(data);
  conference = data.conference;
  records = data.records.map((record) => {
    const displayTitle = readableTitle(record.title);
    return {
      ...record,
      displayTitle,
      searchText: `${record.title} ${displayTitle} ${record.authors.join(" ")}`.toLocaleLowerCase(),
    };
  });
  summaryElement.textContent = [
    `${data.summary.total.toLocaleString()} papers`,
    `${data.summary.archived.toLocaleString()} archived`,
    `${data.summary.publicPdf.toLocaleString()} public PDFs`,
  ].join(" · ");
  siteTitle.textContent = data.conference.title;
  document.title = data.conference.title;
  render();
}

searchInput.addEventListener("input", () => {
  visibleCount = PAGE_SIZE;
  renderedViewerId = null;
  resultsPanel.scrollTop = 0;
  render();
});
statusSelect.addEventListener("change", () => {
  visibleCount = PAGE_SIZE;
  renderedViewerId = null;
  resultsPanel.scrollTop = 0;
  render();
});
loadMoreButton.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  render();
});
init().catch((error) => {
  summaryElement.textContent = error.message;
  summaryElement.classList.add("error");
  viewerTitle.textContent = "Conference data unavailable";
  viewerFrame.replaceChildren(createElement("div", "viewer-empty", error.message));
});
