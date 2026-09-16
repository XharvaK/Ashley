/** Host mechanical status lines for empty, failed, or in-progress work. */

const TR_CHARS = /[ğşıçöüİĞŞÇÖÜ]/;
const TR_WORDS =
  /\b(bir|bu|ne|ama|için|ile|çok|daha|gibi|yok|ben|sen|kanka|valla|olur|hiç|neden|nasıl|mı|mi|değil|bana|beni|senin|şu|abi|tamam|evet|hayır)\b/i;

export function detectLanguage(message: string): "en" | "tr" {
  if (TR_CHARS.test(message)) return "tr";
  return TR_WORDS.test(message) ? "tr" : "en";
}

const LINES_EN = [
  "[system] No sendable output was produced. Please try again.",
  "[system] The response was empty. Please repeat the request.",
  "[system] No output was available. Please try again.",
  "[system] The response could not be produced. Please retry.",
  "[system] No response was returned. Please repeat the request.",
];

const LINES_TR = [
  "[system] Gönderilebilir çıktı üretilmedi. Lütfen tekrar deneyin.",
  "[system] Yanıt boştu. Lütfen isteği tekrarlayın.",
  "[system] Kullanılabilir çıktı yok. Lütfen tekrar deneyin.",
  "[system] Yanıt üretilemedi. Lütfen yeniden deneyin.",
  "[system] Yanıt alınamadı. Lütfen isteği tekrarlayın.",
];

const SEND_FAILED_EN = [
  "[system] Message delivery failed. Please try again.",
  "[system] Message could not be delivered. Please repeat the request.",
];

const SEND_FAILED_TR = [
  "[system] Mesaj teslim edilemedi. Lütfen tekrar deneyin.",
  "[system] Mesaj gönderilemedi. Lütfen isteği tekrarlayın.",
];

const LOOKING_EN = [
  "[system] Checking the request.",
  "[system] Retrieving the requested information.",
  "[system] Request check in progress.",
];

const LOOKING_TR = [
  "[system] İstek kontrol ediliyor.",
  "[system] İstenen bilgi alınıyor.",
  "[system] İstek kontrolü sürüyor.",
];

function rotate(lines: string[], state: { last: number }): string {
  let i = Math.floor(Math.random() * lines.length);
  if (i === state.last) i = (i + 1) % lines.length;
  state.last = i;
  return lines[i]!;
}

const fumbleState = { last: -1 };
const sendState = { last: -1 };
const lookingState = { last: -1 };

export function fumbleLine(message = ""): string {
  const lang = detectLanguage(message);
  return rotate(lang === "tr" ? LINES_TR : LINES_EN, fumbleState);
}

export function sendFailedLine(message = ""): string {
  const lang = detectLanguage(message);
  return rotate(lang === "tr" ? SEND_FAILED_TR : SEND_FAILED_EN, sendState);
}

export function lookingLine(message = ""): string {
  const lang = detectLanguage(message);
  return rotate(lang === "tr" ? LOOKING_TR : LOOKING_EN, lookingState);
}
