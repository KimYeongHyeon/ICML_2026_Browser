const LEGACY_SAVED_KEY = "icml2026:savedIds";
const STUDY_QUEUE_KEY = "icml2026:studyQueue:v1";

export const STUDY_QUEUE_STATUSES = [
  { value: "skim", label: "Skim" },
  { value: "read", label: "Read deeply" },
  { value: "attend", label: "Attend" },
  { value: "cite", label: "Cite later" },
  { value: "done", label: "Done" },
];

export function queueStatusLabel(value) {
  return STUDY_QUEUE_STATUSES.find((item) => item.value === value)?.label || "";
}

function readJsonStorage(storage, key, fallback) {
  if (!storage) return fallback;
  try {
    return JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function browserStorage(name) {
  try {
    return globalThis[name] || null;
  } catch {
    return null;
  }
}

function persistStudyQueue(queue) {
  const local = browserStorage("localStorage");
  const session = browserStorage("sessionStorage");
  try {
    local?.setItem(STUDY_QUEUE_KEY, JSON.stringify([...queue.entries()]));
    local?.removeItem(LEGACY_SAVED_KEY);
    session?.removeItem(LEGACY_SAVED_KEY);
  } catch {
  }
}

function legacySavedIds() {
  const sessionIds = readJsonStorage(browserStorage("sessionStorage"), LEGACY_SAVED_KEY, []);
  const localIds = readJsonStorage(browserStorage("localStorage"), LEGACY_SAVED_KEY, []);
  return [...new Set([...(Array.isArray(sessionIds) ? sessionIds : []), ...(Array.isArray(localIds) ? localIds : [])])];
}

export function loadStudyQueue() {
  const raw = readJsonStorage(browserStorage("localStorage"), STUDY_QUEUE_KEY, []);
  const queue = new Map();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item)) {
        const [id, value] = item;
        if (id) queue.set(String(id), typeof value === "object" && value ? value : { status: "skim" });
      } else if (item?.id) {
        queue.set(String(item.id), { status: item.status || "skim", note: item.note || "", updatedAt: item.updatedAt || "" });
      }
    }
  }
  for (const id of legacySavedIds()) {
    if (id && !queue.has(String(id))) {
      queue.set(String(id), { status: "skim", note: "", updatedAt: new Date().toISOString() });
    }
  }
  persistStudyQueue(queue);
  return queue;
}

export function queuedIds(queue) {
  return new Set(queue.keys());
}

export function queueEntry(queue, id) {
  return queue.get(id) || null;
}

export function studyQueueStats(queue) {
  const counts = { total: queue.size };
  for (const item of queue.values()) {
    const status = item?.status || "skim";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

export function loadSavedIds() {
  return queuedIds(loadStudyQueue());
}

export function toggleSavedId(savedIds, id) {
  if (!id) return;
  if (savedIds.has(id)) savedIds.delete(id);
  else savedIds.add(id);
  const local = browserStorage("localStorage");
  const session = browserStorage("sessionStorage");
  try {
    local?.setItem(LEGACY_SAVED_KEY, JSON.stringify([...savedIds]));
    session?.setItem(LEGACY_SAVED_KEY, JSON.stringify([...savedIds]));
  } catch {
  }
}

export function toggleStudyQueueRecord(queue, id) {
  if (!id) return queuedIds(queue);
  if (queue.has(id)) {
    queue.delete(id);
  } else {
    queue.set(id, { status: "skim", note: "", updatedAt: new Date().toISOString() });
  }
  persistStudyQueue(queue);
  return queuedIds(queue);
}

export function setStudyQueueStatus(queue, id, status) {
  if (!id) return queuedIds(queue);
  if (!status) {
    queue.delete(id);
  } else {
    queue.set(id, {
      ...(queue.get(id) || {}),
      status,
      updatedAt: new Date().toISOString(),
    });
  }
  persistStudyQueue(queue);
  return queuedIds(queue);
}
