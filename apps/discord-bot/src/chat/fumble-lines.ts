/**
 * When generation produces nothing sendable, Doc still gets something in her
 * voice. One fixed string would become a tell within a week.
 */

const TR_CHARS = /[ğşıçöüİĞŞÇÖÜ]/;
const TR_WORDS =
  /\b(bir|bu|ne|ama|için|ile|çok|daha|gibi|yok|ben|sen|kanka|valla|olur|hiç|neden|nasıl|mı|mi|değil|bana|beni|senin|şu|abi|tamam|evet|hayır)\b/i;

export function detectLanguage(message: string): "en" | "tr" {
  if (TR_CHARS.test(message)) return "tr";
  return TR_WORDS.test(message) ? "tr" : "en";
}

const LINES_EN = [
  "blanked on that one, hit me again",
  "lost the thread there. say it again?",
  "that came out as nothing. one more time",
  "nope, brain went somewhere else. again?",
  "i had something and dropped it. repeat that",
];

const LINES_TR = [
  "kafam boşaldı, bir daha dene",
  "kaçırdım onu. tekrarlar mısın?",
  "bir şey çıkmadı. bir kez daha?",
  "beyin başka yere gitti. yine?",
  "vardı bir şey, düşürdüm. tekrar et",
];

const SEND_FAILED_EN = [
  "that one didn't go through. say it again?",
  "discord ate that. one more time",
];

const SEND_FAILED_TR = [
  "o gitmedi. bir daha dene?",
  "discord yedi onu. bir kez daha",
];

const LOOKING_EN = [
  "hang on, looking",
  "one sec, checking",
  "gimme a sec, pulling it up",
];

const LOOKING_TR = [
  "bir saniye, bakıyorum",
  "dur, bir bakayım",
  "hemen, çekiyorum",
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
