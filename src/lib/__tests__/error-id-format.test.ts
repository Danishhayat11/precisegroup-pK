import { describe, it, expect } from "vitest";
import {
  ERROR_ID_LENGTH,
  ERROR_ID_REGEX,
  generateErrorId,
  isValidErrorId,
  normalizeErrorId,
  renderErrorPage,
} from "../error-page";

describe("error Ref ID format", () => {
  it("generateErrorId always matches the canonical 8-8 base36 format", () => {
    for (let i = 0; i < 500; i++) {
      const id = generateErrorId();
      expect(id).toMatch(ERROR_ID_REGEX);
      expect(id).toHaveLength(ERROR_ID_LENGTH);
      expect(id).toBe(id.toUpperCase());
    }
  });

  it("isValidErrorId accepts canonical IDs and rejects everything else", () => {
    expect(isValidErrorId(generateErrorId())).toBe(true);
    expect(isValidErrorId("ABCDEFGH-12345678")).toBe(true);

    for (const bad of [
      "",
      "abcdefgh-12345678", // lowercase
      "ABCDEFGH 12345678", // wrong separator
      "ABCDEFGH-1234567", // too short
      "ABCDEFGH-123456789", // too long
      "ABCDEFG!-12345678", // invalid char
      "ABCDEFGH_12345678",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isValidErrorId(bad as unknown)).toBe(false);
    }
  });

  it("normalizeErrorId passes through valid IDs and mints a canonical one otherwise", () => {
    const good = generateErrorId();
    expect(normalizeErrorId(good)).toBe(good);

    for (const bad of ["", "nope", "abc", null, undefined]) {
      const out = normalizeErrorId(bad as unknown);
      expect(out).toMatch(ERROR_ID_REGEX);
    }
  });

  it("renderErrorPage emits the canonical ID in meta tag, <code>, and copy handler", () => {
    const id = generateErrorId();
    const html = renderErrorPage(id, { method: "GET", path: "/dashboard" });

    expect(html).toContain(`<meta name="x-error-id" content="${id}"`);
    expect(html).toContain(`<code id="err-id">${id}</code>`);
    expect(html).toContain(`writeText('${id}')`);

    // Every occurrence of an ID-shaped token in the page must match the canonical format.
    const tokens = html.match(/\b[0-9A-Z]{8}-[0-9A-Z]{8}\b/g) ?? [];
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(t).toBe(id);
  });

  it("renderErrorPage replaces an invalid supplied ID with a canonical one", () => {
    const html = renderErrorPage("not-an-id", { method: "GET", path: "/" });
    const m = html.match(/<code id="err-id">([^<]+)<\/code>/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(ERROR_ID_REGEX);
  });
});
