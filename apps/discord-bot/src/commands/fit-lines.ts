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

/** Whole lines in pages no longer than the limit, so a long list goes out over several messages instead of being cut. */
export function pageLines(lines: string[], limit = 1900): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const raw of lines) {
    const line = raw.slice(0, limit);
    const joined = current.length === 0 ? line.length : length + 1 + line.length;
    if (joined > limit) {
      pages.push(current.join("\n"));
      current = [line];
      length = line.length;
    } else {
      current.push(line);
      length = joined;
    }
  }
  if (current.length > 0) pages.push(current.join("\n"));
  return pages;
}
