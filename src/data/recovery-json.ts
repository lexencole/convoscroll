import { MAX_JSON_NESTING_DEPTH } from "./document-loader";

const invalidRecord = () => new Error("记录包含循环引用或无法保留的非 JSON 数据");

/** Validate and serialize without invoking object methods or recursing through damaged records. */
export function serializeRecoveryRecord(value: unknown): string {
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  const frames: { value: object; keys: readonly string[]; index: number; array: boolean }[] = [];
  let maximumDepth = 0;

  function append(item: unknown) {
    if (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      chunks.push(JSON.stringify(item));
      return;
    }
    if (typeof item !== "object" || ancestors.has(item)) throw invalidRecord();
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalidRecord();
    const ownKeys = Reflect.ownKeys(item);
    if (ownKeys.some((key) => typeof key !== "string")) throw invalidRecord();
    const keys = array ? ownKeys.filter((key) => key !== "length") as string[] : ownKeys as string[];
    if (array && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) throw invalidRecord();
    ancestors.add(item);
    frames.push({ value: item, keys, index: 0, array });
    maximumDepth = Math.max(maximumDepth, frames.length);
    chunks.push(array ? "[" : "{");
  }

  append(value);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index === frame.keys.length) {
      chunks.push(frame.array ? "]" : "}");
      ancestors.delete(frame.value);
      frames.pop();
      continue;
    }
    const key = frame.keys[frame.index];
    const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalidRecord();
    if (frame.index++ > 0) chunks.push(",");
    if (!frame.array) chunks.push(JSON.stringify(key), ":");
    append(descriptor.value);
  }

  // Keep the established readable download for ordinary records; deep records use
  // the already generated compact JSON to avoid call-stack and indentation growth.
  return maximumDepth <= MAX_JSON_NESTING_DEPTH ? JSON.stringify(value, null, 2) : chunks.join("");
}
