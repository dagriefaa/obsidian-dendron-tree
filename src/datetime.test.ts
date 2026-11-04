import { isLegacyTimestamp, legacyToDatetime, parseTimestamp, timestampToMillis, toDatetimeString } from "./datetime";
import moment from "moment";

const SECONDS = 1640084494;
const MILLIS = 1640084494155;

describe("isLegacyTimestamp", () => {
  it("accepts unix millis and seconds numbers", () => {
    expect(isLegacyTimestamp(MILLIS)).toBe(true);
    expect(isLegacyTimestamp(SECONDS)).toBe(true);
    expect(isLegacyTimestamp("1234567890123")).toBe(true);
    expect(isLegacyTimestamp(0)).toBe(false);
    expect(isLegacyTimestamp(-1)).toBe(false);
    expect(isLegacyTimestamp(NaN)).toBe(false);
  });
  it("rejects datetime strings and other values", () => {
    expect(isLegacyTimestamp("2025-10-30T23:00:00")).toBe(false);
    expect(isLegacyTimestamp("")).toBe(false);
    expect(isLegacyTimestamp(undefined)).toBe(false);
    expect(isLegacyTimestamp(null)).toBe(false);
    expect(isLegacyTimestamp(new Date())).toBe(false);
  });
});

describe("timestampToMillis", () => {
  it("treats small values as unix seconds and large as millis", () => {
    expect(timestampToMillis(SECONDS)).toBe(SECONDS * 1000);
    expect(timestampToMillis(MILLIS)).toBe(MILLIS);
  });
});

describe("toDatetimeString", () => {
  it("formats legacy millis with the given moment format", () => {
    expect(toDatetimeString(MILLIS, "YYYY-MM-DD")).toBe(moment(MILLIS).format("YYYY-MM-DD"));
    expect(toDatetimeString(SECONDS, "YYYY-MM-DDTHH:mm:ss")).toBe(moment(SECONDS * 1000).format("YYYY-MM-DDTHH:mm:ss"));
  });
});

describe("legacyToDatetime", () => {
  it("converts numeric timestamps in millis or seconds", () => {
    expect(legacyToDatetime(MILLIS, "YYYY-MM-DD")).toBe(moment(MILLIS).format("YYYY-MM-DD"));
    expect(legacyToDatetime(SECONDS, "YYYY-MM-DD")).toBe(moment(SECONDS * 1000).format("YYYY-MM-DD"));
  });
  it("converts numeric strings", () => {
    expect(legacyToDatetime("1640084494155", "YYYY-MM-DD")).toBe(moment(MILLIS).format("YYYY-MM-DD"));
  });
  it("leaves datetime strings and invalid values untouched", () => {
    expect(legacyToDatetime("2025-10-30T23:00:00", "YYYY-MM-DD")).toBeUndefined();
    expect(legacyToDatetime(0, "YYYY-MM-DD")).toBeUndefined();
    expect(legacyToDatetime(undefined, "YYYY-MM-DD")).toBeUndefined();
  });
});

describe("parseTimestamp", () => {
  it("supports legacy seconds and millis", () => {
    expect(parseTimestamp(SECONDS)).toBe(SECONDS * 1000);
    expect(parseTimestamp(MILLIS)).toBe(MILLIS);
    expect(parseTimestamp("1640084494155")).toBe(MILLIS);
  });
  it("parses datetime strings back to millis", () => {
    const formatted = moment(MILLIS).format("YYYY-MM-DDTHH:mm:ss");
    expect(parseTimestamp(formatted)).toBe(moment(formatted).valueOf());
  });
  it("round trips with toDatetimeString at second precision", () => {
    const ts = 1640084494000;
    expect(parseTimestamp(toDatetimeString(ts, "YYYY-MM-DDTHH:mm:ss"))).toBe(ts);
  });
  it("supports Date objects", () => {
    const date = new Date(MILLIS);
    expect(parseTimestamp(date)).toBe(MILLIS);
  });
  it("returns Infinity for missing or invalid values", () => {
    expect(parseTimestamp(undefined)).toBe(Infinity);
    expect(parseTimestamp(null)).toBe(Infinity);
    expect(parseTimestamp(NaN)).toBe(Infinity);
    expect(parseTimestamp("")).toBe(Infinity);
    expect(parseTimestamp("not a date")).toBe(Infinity);
  });
});