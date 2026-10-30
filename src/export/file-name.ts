const MAX_LENGTH = 80;

/**
 * One rule for every downloaded file (PNG, ZIP, project): keep the title as the
 * user wrote it, including case and full-width punctuation, and only replace the
 * characters file systems reject. Returns "" when nothing usable is left.
 */
export function safeFileBaseName(value: string): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "");
  return Array.from(cleaned).slice(0, MAX_LENGTH).join("").replace(/[\s.-]+$/, "");
}
