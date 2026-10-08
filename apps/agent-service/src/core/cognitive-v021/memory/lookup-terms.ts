/**
 * M5: the words a memory lookup searches for. A small fixed English list of
 * function words carries no topic, so "what did you do in the house" searches
 * for "house" alone. Terms under three characters are dropped for the same reason.
 */
const LOOKUP_STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "all", "also", "am", "and", "any", "are", "because",
  "been", "before", "being", "below", "between", "both", "but", "can", "could", "did", "do", "does",
  "doing", "done", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "her", "here", "hers", "him", "his", "how", "into", "its", "just", "more", "most", "much",
  "must", "nor", "not", "now", "off", "once", "one", "only", "other", "our", "ours", "out", "over",
  "own", "same", "she", "should", "some", "such", "than", "that", "the", "their", "theirs", "them",
  "then", "there", "these", "they", "this", "those", "through", "too", "under", "until", "very",
  "was", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with",
  "would", "yes", "you", "your", "yours",
]);

/** Lower-cased content terms of a lookup query, first occurrence order, without duplicates. */
export function lookupTerms(text: string): string[] {
  return [...new Set(text.toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3 && !LOOKUP_STOPWORDS.has(term)))];
}
