import { describe, expect, it, vi } from "vitest";
import { serializeRecoveryRecord } from "./recovery-json";

describe("original record recovery JSON", () => {
  it("keeps normal JSON formatting, escaping, opaque keys and shared references", () => {
    const shared = { text: "中文 😀 \" \\ \n" };
    const record = { document: JSON.parse('{"__proto__":{"keep":true}}'), values: [shared, shared, null, 42, false] };
    expect(serializeRecoveryRecord(record)).toBe(JSON.stringify(record, null, 2));
    expect(JSON.parse(serializeRecoveryRecord(record))).toEqual(record);
  });

  it("recovers all 8000 levels as compact JSON without recursive serialization", () => {
    const nested = JSON.parse("[".repeat(8000) + '"完整原文"' + "]".repeat(8000));
    const serialized = serializeRecoveryRecord({ document: nested });
    expect(serialized).toBe('{"document":' + "[".repeat(8000) + '"完整原文"' + "]".repeat(8000) + "}");
    let restored = JSON.parse(serialized).document;
    for (let index = 0; index < 8000; index++) {
      expect(Array.isArray(restored)).toBe(true);
      expect(restored.length).toBe(1);
      restored = restored[0];
    }
    expect(restored).toBe("完整原文");
  });

  it.each([undefined, NaN, Infinity, 1n, new Date(), new Map(), new Blob(["bytes"]), [undefined], new Array(1), { missing: undefined }])("refuses values JSON would discard or rewrite: %s", (value) => {
    expect(() => serializeRecoveryRecord({ document: value })).toThrow(/非 JSON/);
  });

  it("refuses cycles, symbols and accessors without executing them", () => {
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => serializeRecoveryRecord(cyclic)).toThrow(/循环引用/);
    expect(() => serializeRecoveryRecord({ [Symbol("hidden")]: "keep" })).toThrow(/非 JSON/);
    const getter = vi.fn(() => "must not run");
    const record = Object.defineProperty({}, "document", { enumerable: true, get: getter });
    expect(() => serializeRecoveryRecord(record)).toThrow(/非 JSON/);
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => "must not run");
    expect(() => serializeRecoveryRecord({ toJSON })).toThrow(/非 JSON/);
    expect(toJSON).not.toHaveBeenCalled();
  });
});
