import { describe, expect, it } from "vitest";

import { countLetters, isAlreadyEnglishTranscript } from "./transcript-language";

describe("isAlreadyEnglishTranscript", () => {
  it("skips translation for English in Latin letters only", () => {
    expect(isAlreadyEnglishTranscript("eng", "She said the exam stress is high.")).toBe(true);
    expect(isAlreadyEnglishTranscript("en", "Fine.")).toBe(true);
    expect(isAlreadyEnglishTranscript(" ENG ", "Fine.")).toBe(true);
  });

  it("translates English with even one Devanagari word in it", () => {
    expect(isAlreadyEnglishTranscript("eng", "She said the exam stress is बहुत high.")).toBe(false);
  });

  it("translates romanised Hindi that Scribe calls Hindi", () => {
    expect(isAlreadyEnglishTranscript("hin", "Usne bola exam ka stress hai.")).toBe(false);
  });

  it.each([[null], [""], ["  "]])("translates when Scribe gives no language code (%j)", (code) => {
    expect(isAlreadyEnglishTranscript(code, "She said the exam is hard.")).toBe(false);
  });

  it("translates another language code even in plain Latin letters", () => {
    expect(isAlreadyEnglishTranscript("english", "Fine.")).toBe(false);
    expect(isAlreadyEnglishTranscript("spa", "Fine.")).toBe(false);
  });

  it.each([
    ["accented Latin letters", "Café, señor, naïve résumé."],
    ["digits and punctuation", "Marks: 72/100 (up 15%) — on 12-11-2026!"],
    ["emoji, skin tones and joined emoji", "Great 👍🏽 ❤️ 👨‍👩‍👧 job"],
  ])("does not count %s as non-Latin", (_label, text) => {
    expect(isAlreadyEnglishTranscript("eng", text)).toBe(true);
  });

  it.each([
    ["Gurmukhi", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ"],
    ["Tamil", "வணக்கம்"],
    ["Arabic script", "شکریہ"],
    ["Bengali", "ধন্যবাদ"],
  ])("translates text with %s letters", (_label, text) => {
    expect(isAlreadyEnglishTranscript("eng", `Thanks ${text}`)).toBe(false);
  });
});

describe("countLetters", () => {
  it("counts letters and the ones outside the Latin script, ignoring digits, punctuation and emoji", () => {
    expect(countLetters("Ab 12 !? 👍")).toEqual({ letters: 2, nonLatin: 0 });
    // छात्र: three consonants, a vowel sign and a virama, all Devanagari.
    expect(countLetters("ok छात्र")).toEqual({ letters: 7, nonLatin: 5 });
  });
});
