export interface MessageTimestampDraft {
  readonly date: string;
  readonly time: string;
}

const timestampPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/;

export function messageTimestampFields(value?: string): MessageTimestampDraft {
  const parts = value?.match(timestampPattern);
  return { date: parts?.[1] ?? "", time: parts?.[2] ?? "" };
}

function localDate(fields: MessageTimestampDraft): Date {
  return new Date(`${fields.date}T${fields.time}:00`);
}

function localOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

export function messageTimestampZone(value: string | undefined, fields: MessageTimestampDraft): string {
  const stored = value?.match(timestampPattern)?.[4];
  if (stored) return stored === "Z" ? "+00:00" : stored;
  const selected = localDate(fields);
  return localOffset(Number.isFinite(selected.getTime()) ? selected : new Date());
}

/** Preserve the source offset and precision; only new timestamps use the device's timezone. */
export function messageTimestampValue(fields: MessageTimestampDraft, previous?: string): string | undefined {
  if (!fields.date && !fields.time) return undefined;
  if (!fields.date) throw new Error("请选择日期");
  if (!fields.time) throw new Error("请输入时间");
  const date = new Date(`${fields.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || fields.date.startsWith("0000")
    || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== fields.date) throw new Error("请填写有效日期");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) throw new Error("请输入 HH:mm，例如 14:30");
  const original = previous?.match(timestampPattern);
  if (!original) {
    const selected = localDate(fields);
    const pad = (value: number) => String(value).padStart(2, "0");
    if (selected.getHours() !== Number(fields.time.slice(0, 2)) || selected.getMinutes() !== Number(fields.time.slice(3))
      || `${String(selected.getFullYear()).padStart(4, "0")}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}` !== fields.date) {
      throw new Error("此时间因夏令时调整不存在，请选择其他时间");
    }
  }
  return `${fields.date}T${fields.time}${original?.[3] ?? ":00"}${original?.[4] ?? messageTimestampZone(undefined, fields)}`;
}
