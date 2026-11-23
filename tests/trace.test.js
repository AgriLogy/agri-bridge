import { describe, expect, it } from "vitest";

import { previewBody } from "../src/trace.js";

describe("previewBody", () => {
  it("serializes parsed JSON", () => {
    expect(previewBody({ user: "Router01", t: 1 }, 100)).toBe('{"user":"Router01","t":1}');
  });

  it("passes raw text through", () => {
    expect(previewBody("{not json", 100)).toBe("{not json");
  });

  it("truncates long bodies and says by how much", () => {
    expect(previewBody("abcdefghij", 4)).toBe("abcd…[truncated 6 chars]");
  });

  it("returns null when disabled or empty", () => {
    expect(previewBody({ a: 1 }, 0)).toBeNull();
    expect(previewBody(undefined, 100)).toBeNull();
    expect(previewBody(null, 100)).toBeNull();
    expect(previewBody("", 100)).toBeNull();
  });
});
