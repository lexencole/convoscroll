/**
 * Short notices, statuses and error lines read like labels: they end without "。",
 * which would otherwise leave a full-width blank at the end of the line.
 * Paragraphs (the about dialog, the crash screen) keep normal punctuation.
 */
export function noticeText(text: string): string {
  return text.endsWith("。") ? text.slice(0, -1) : text;
}
