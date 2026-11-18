import { describe, expect, it } from "vitest";
import { formatPhone, isPlaceholderEmail, normalizePhone, placeholderEmailForPhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it.each([
    ["9810000005", "+919810000005"],
    ["98100 00005", "+919810000005"],
    ["098100-00005", "+919810000005"],
    ["+91 98100 00005", "+919810000005"],
    ["919810000005", "+919810000005"],
    ["0091 9810000005", "+919810000005"],
    ["+1 415 555 0100", "+14155550100"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "12345", "+12"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("placeholder emails", () => {
  it("are derived from the phone and recognisable", () => {
    const email = placeholderEmailForPhone("+919810000005");
    expect(email).toBe("919810000005@phone.taamara.invalid");
    expect(isPlaceholderEmail(email)).toBe(true);
    expect(isPlaceholderEmail("priya@demo.taamara.in")).toBe(false);
  });
});

describe("formatPhone", () => {
  it("groups Indian mobile numbers", () => {
    expect(formatPhone("+919810000005")).toBe("+91 98100 00005");
    expect(formatPhone("+14155550100")).toBe("+14155550100");
    expect(formatPhone(null)).toBe("");
  });
});
