/**
 * FTS5 query helpers for the BQ questbook graph.
 */
export function ftsEscape(q) {
  return String(q).replace(/[^\p{L}\p{N}\s_-]/gu, " ").trim().split(/\s+/)
    .filter(Boolean).map(t => `"${t}"`).join(" ");
}
