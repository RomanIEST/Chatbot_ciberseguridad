export function normalizeLegalText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function extractArticleReferences(text = "") {
  const normalized = normalizeLegalText(text);
  const references = new Set();
  const pattern =
    /\b(?:articulo(?:s)?|art\.?)\s+(\d+)(?:\s*(bis|ter|quater|quinquies)(?:\s*(\d+))?)?/giu;

  for (const match of normalized.matchAll(pattern)) {
    references.add([match[1], match[2], match[3]].filter(Boolean).join(" "));

    const tail = normalized.slice(
      match.index + match[0].length,
      match.index + match[0].length + 24,
    );
    const chainedPattern =
      /^\s*(?:,|y|o)\s*(\d+)(?:\s*(bis|ter|quater|quinquies)(?:\s*(\d+))?)?/giu;
    for (const chained of tail.matchAll(chainedPattern)) {
      references.add(
        [chained[1], chained[2], chained[3]].filter(Boolean).join(" "),
      );
    }
  }

  return [...references];
}

export function articleAppearsInEvidence(reference, evidenceText = "") {
  const parts = normalizeLegalText(reference).split(" ");
  if (!parts.length || !parts[0]) return false;
  const escaped = parts.map((part) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`\\barticulo\\s+${escaped.join("\\s+")}\\b`, "u");
  return pattern.test(normalizeLegalText(evidenceText));
}
