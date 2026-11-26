import { afterEach, describe, expect, it } from "vitest";
import { checkRate, LIMITS, RateLimitError, resetRates } from "@/lib/rate-limit";

afterEach(() => resetRates());

describe("rate limits", () => {
  it("allow up to the limit in a minute, per person and per kind", () => {
    const t = 1_000_000;
    for (let i = 0; i < LIMITS.export.max; i++) checkRate("u1", "export", t + i);
    expect(() => checkRate("u1", "export", t + 100)).toThrow(RateLimitError);
    // Someone else, or another kind of request, is not affected.
    expect(() => checkRate("u2", "export", t + 100)).not.toThrow();
    expect(() => checkRate("u1", "file.get", t + 100)).not.toThrow();
  });

  it("say how long to wait, and let people back in after the window", () => {
    const t = 2_000_000;
    for (let i = 0; i < LIMITS["message.post"].max; i++) checkRate("u1", "message.post", t);
    try {
      checkRate("u1", "message.post", t + 15_000);
      throw new Error("should have been limited");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).status).toBe(429);
      expect((e as RateLimitError).retryAfterSeconds).toBe(45);
    }
    expect(() => checkRate("u1", "message.post", t + 60_001)).not.toThrow();
  });
});
