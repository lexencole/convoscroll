import { Extension, markInputRule } from "@tiptap/core";

// Tiptap turns **bold**, *italic* and ~~strike~~ into formatting only at the start
// of a line or after a space. Chinese puts no spaces between words, so these rules
// also convert after CJK characters and full-width punctuation. The lookbehind keeps
// the preceding character out of the match, so the rule never deletes it.
const AFTER_CJK = "(?<=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3000-\\u303f\\uff00-\\uffef\\u2018-\\u201d\\u2014\\u2026])";

export const boldAfterCjk = new RegExp(`${AFTER_CJK}(\\*\\*(?!\\s+\\*\\*)((?:[^*]+))\\*\\*(?!\\s+\\*\\*))$`, "u");
export const italicAfterCjk = new RegExp(`${AFTER_CJK}(\\*(?!\\s+\\*)((?:[^*]+))\\*(?!\\s+\\*))$`, "u");
export const strikeAfterCjk = new RegExp(`${AFTER_CJK}(~~(?!\\s+~~)((?:[^~]+))~~(?!\\s+~~))$`, "u");

export const CjkMarkInputRules = Extension.create({
  name: "cjkMarkInputRules",
  addInputRules() {
    const { bold, italic, strike } = this.editor.schema.marks;
    return [
      markInputRule({ find: boldAfterCjk, type: bold }),
      markInputRule({ find: italicAfterCjk, type: italic }),
      markInputRule({ find: strikeAfterCjk, type: strike }),
    ];
  },
});
