/**
 * The em dash ban is a prompt rule the model breaks a few percent of the time,
 * and once is enough for Doc to hear the assistant underneath. Same for smart
 * quotes: no messenger types them. So the prompt asks and this enforces.
 */
function sanitizeSegment(text: string): string {
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*([,.!?;:])/g, "$1")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\u2026/g, "...");
}

export function sanitizeTypography(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 === 1 ? part : sanitizeSegment(part)))
    .join("");
}
