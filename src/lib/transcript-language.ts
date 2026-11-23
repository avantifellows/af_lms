// Which script a Dictation (#500) transcript is written in, and whether it is
// already English. Dependency-free; the server uses it to decide whether a
// clip needs translating and to check the translation that comes back.

// A letter is any Unicode letter or combining mark, so Devanagari vowel signs
// count alongside their consonants. A letter is outside the Latin script unless
// it is Latin, or Common/Inherited (shared symbols, combining accents, emoji
// variation selectors). Digits, punctuation and emoji are not letters.
const LETTER = /[\p{L}\p{M}]/gu;
const NON_LATIN_LETTER = /(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{M}]/gu;

export type LetterCounts = { letters: number; nonLatin: number };

export function countLetters(text: string): LetterCounts {
  return {
    letters: text.match(LETTER)?.length ?? 0,
    nonLatin: text.match(NON_LATIN_LETTER)?.length ?? 0,
  };
}

const ENGLISH_LANGUAGE_CODES = new Set(["eng", "en"]);

// Already English only when Scribe says English AND not one letter is outside
// the Latin script. A missing code, another language (romanised Hindi comes
// back as "hin") or any Devanagari word means the clip is translated.
export function isAlreadyEnglishTranscript(languageCode: string | null, text: string): boolean {
  const code = languageCode?.trim().toLowerCase() ?? "";
  return ENGLISH_LANGUAGE_CODES.has(code) && countLetters(text).nonLatin === 0;
}
