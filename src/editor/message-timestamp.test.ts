import { describe, expect, it } from "vitest";
import { messageTimestampFields, messageTimestampValue, messageTimestampZone } from "./message-timestamp";

describe("message timestamp fields", () => {
  it("reads date and minute fields without converting the original timezone", () => {
    const value = "2026-09-20T12:34:56.123456+05:45";
    expect(messageTimestampFields(value)).toEqual({ date: "2026-09-20", time: "12:34" });
    expect(messageTimestampZone(value, messageTimestampFields(value))).toBe("+05:45");
    expect(messageTimestampValue(messageTimestampFields(value), value)).toBe(value);
  });
  it("retains seconds, fractional precision and offset when changing the date or minute", () => {
    expect(messageTimestampValue({ date: "2026-10-21", time: "08:15" }, "2026-09-20T12:34:56.123456-03:30"))
      .toBe("2026-10-21T08:15:56.123456-03:30");
    expect(messageTimestampValue({ date: "2026-10-21", time: "08:15" }, "2026-09-20T12:34:00Z"))
      .toBe("2026-10-21T08:15:00Z");
  });
  it("creates new timestamps at the selected local time", () => {
    const value = messageTimestampValue({ date: "2026-09-20", time: "12:34" });
    expect(new Date(value!).getTime()).toBe(new Date(2026, 8, 20, 12, 34).getTime());
    expect(value).toMatch(/^2026-09-20T12:34:00[+-]\d{2}:\d{2}$/);
  });
  it("treats empty fields as no timestamp, but rejects a partially typed time", () => {
    expect(messageTimestampFields()).toEqual({ date: "", time: "" });
    expect(messageTimestampValue({ date: "", time: "" }, "2026-09-20T12:00:00Z")).toBeUndefined();
    expect(() => messageTimestampValue({ date: "2026-09-20", time: "12:" })).toThrow("请输入 HH:mm");
    expect(() => messageTimestampValue({ date: "2026-09-20", time: ":30" })).toThrow("请输入 HH:mm");
    expect(() => messageTimestampValue({ date: "2026-09-20", time: "" })).toThrow("请输入时间");
    expect(() => messageTimestampValue({ date: "", time: "12:00" })).toThrow("请选择日期");
  });
  it("rejects dates that would silently roll over and accepts leap days", () => {
    for (const date of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-13-01", "tomorrow"]) {
      expect(() => messageTimestampValue({ date, time: "12:00" })).toThrow("请填写有效日期");
    }
    expect(messageTimestampValue({ date: "2028-02-29", time: "12:00" }, "2026-09-20T12:00:00Z")).toBe("2028-02-29T12:00:00Z");
  });
  it("rejects invalid times", () => {
    for (const time of ["24:00", "12:60", "8:00", "12:00:30"]) {
      expect(() => messageTimestampValue({ date: "2026-09-20", time })).toThrow("请输入 HH:mm");
    }
  });
});
