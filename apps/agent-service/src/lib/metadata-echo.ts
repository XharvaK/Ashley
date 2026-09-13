/**
 * Replies must never open with a bare material-metadata label ("medium depth",
 * "Depth: excerpt", "Piece:", "Take:"). Those belong to internal material
 * blocks; leaking one into a bubble teaches the format as part of her voice
 * and reads like a heading, not speech. Hard floor: prompt drift cannot leak.
 */

const METADATA_HEADER: RegExp[] = [
  /^(short|medium|deep|full|excerpt|light|minimal)\s+depth\s*[:.]?\s*$/i,
  /^depth\s*:\s*(full|excerpt|medium|deep|short|light|minimal)\s*$/i,
  /^(piece|take|material)\s*:\s*.+$/i,
];

function isMetadataLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return METADATA_HEADER.some((p) => p.test(trimmed));
}

/**
 * Drop leading metadata lines from the whole reply and from every paragraph,
 * so a leaked label cannot survive as its own bubble after split-message.
 */
export function stripMetadataEcho(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const cleaned = paragraphs
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      let start = 0;
      while (start < lines.length && isMetadataLine(lines[start]!)) start++;
      return lines.slice(start).join("\n").trim();
    })
    .filter((paragraph) => paragraph.length > 0);
  return cleaned.join("\n\n").trim();
}

/**
 * Pipeline narration is the model reciting system-note scaffolding as its own
 * speech ("i opened the link he sent", "pulling it up"). Class rule, not a
 * phrase list: a short standalone paragraph that reports the mechanics of the
 * pipeline instead of saying something. Content-bearing openers survive the
 * length/word floor; unlicensed reading claims are already floored upstream by
 * the claim gate.
 *
 * Ownership: Expression (language cleanup), not Rendering transport.
 */
const WAIT_INTJ =
  /^(gimme|lemme|one sec|one second|hang on|hold on|just a sec|sec)\b/i;
const FIRST_PERSON =
  /^i(?:'ve|'m|'m gonna| have| had| am| was| will| just)?\b/i;
/**
 * "Getting the page" family only. Deliberately excludes check/look/read so
 * genuine openers ("i looked it up, it's fine", "i've been reading about...")
 * survive; the note hygiene is the primary fix, this strip is defense in depth.
 */
const PIPELINE_REPORT =
  /\b(open(?:ed|ing)?|pull(?:ed|ing)?|fetch(?:ed|ing)?|grab(?:bed|bing)?|got)\b/i;

function isPipelineNarration(paragraph: string): boolean {
  const text = paragraph.trim();
  if (!text || text.length > 60) return false;
  const words = text.split(/\s+/).length;
  if (words > 8) return false;
  if (WAIT_INTJ.test(text)) {
    // "hang on, looking" / "gimme a sec, pulling it up"
    return words <= 3 || PIPELINE_REPORT.test(text);
  }
  return FIRST_PERSON.test(text) && PIPELINE_REPORT.test(text);
}

/**
 * Drop standalone pipeline-narration paragraphs from the whole reply, so the
 * mechanics report cannot survive as its own bubble after split-message.
 */
export function stripPipelineNarration(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const cleaned = paragraphs
    .filter((paragraph) => !isPipelineNarration(paragraph))
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return cleaned.join("\n\n").trim();
}
