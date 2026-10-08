/** Host mechanical status lines for empty, failed, or in-progress work. */

const TR_CHARS = /[ğşıçöüİĞŞÇÖÜ]/;
const TR_WORDS =
  /\b(bir|bu|ne|ama|için|ile|çok|daha|gibi|yok|ben|sen|kanka|valla|olur|hiç|neden|nasıl|mı|mi|değil|bana|beni|senin|şu|abi|tamam|evet|hayır)\b/i;

export function detectLanguage(message: string): "en" | "tr" {
  if (TR_CHARS.test(message)) return "tr";
  return TR_WORDS.test(message) ? "tr" : "en";
}

const SEND_FAILED_EN = [
  "[system] Message delivery failed. Please try again.",
  "[system] Message could not be delivered. Please repeat the request.",
];

const SEND_FAILED_TR = [
  "[system] Mesaj teslim edilemedi. Lütfen tekrar deneyin.",
  "[system] Mesaj gönderilemedi. Lütfen isteği tekrarlayın.",
];

function rotate(lines: string[], state: { last: number }): string {
  let i = Math.floor(Math.random() * lines.length);
  if (i === state.last) i = (i + 1) % lines.length;
  state.last = i;
  return lines[i]!;
}

const sendState = { last: -1 };

export function sendFailedLine(message = ""): string {
  const lang = detectLanguage(message);
  return rotate(lang === "tr" ? SEND_FAILED_TR : SEND_FAILED_EN, sendState);
}
