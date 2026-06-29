export function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsNormalizedPhrase(haystack, needle) {
  if (!needle) return true;
  let index = String(haystack || "").indexOf(needle);
  while (index >= 0) {
    const before = index === 0 || haystack[index - 1] === " ";
    const afterIndex = index + needle.length;
    const after = afterIndex === haystack.length || haystack[afterIndex] === " ";
    if (before && after) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}
