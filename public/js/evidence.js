// Builds the exact string src/engine/session.ts's parsePlayerInput() regex
// expects: "PRESENT e1,e3: <question>" or just the bare question if no
// evidence chips are staged. Keeps all evidence-ID validation server-side —
// this never duplicates that logic, it only matches the wire format.

export function buildPlayerInput(evidenceIds, question) {
  const trimmed = question.trim()
  if (evidenceIds.length === 0) return trimmed
  return `PRESENT ${evidenceIds.join(',')}: ${trimmed}`
}
