/** Whole lines up to the limit, so a cut never splits a line. A single line too long for the limit is cut hard. */
export function fitLines(lines: string[], limit = 1900): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const next = length + (kept.length > 0 ? 1 : 0) + line.length;
    if (next > limit) break;
    kept.push(line);
    length = next;
  }
  if (kept.length === 0 && lines.length > 0) return lines[0]!.slice(0, limit);
  return kept.join("\n");
}
