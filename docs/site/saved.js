const SAVED_KEY = "icml2026:savedIds";

export function loadSavedIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SAVED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function toggleSavedId(savedIds, id) {
  if (!id) return;
  if (savedIds.has(id)) savedIds.delete(id);
  else savedIds.add(id);
  try {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify([...savedIds]));
  } catch {
  }
}
