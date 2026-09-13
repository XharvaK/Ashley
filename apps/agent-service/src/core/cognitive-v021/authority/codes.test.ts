import { describe, expect, it } from "vitest";
import { AUTHORITY_CODES, describeAuthorityCode } from "./codes.js";
import type { AuthorityCode } from "../types.js";

describe("v0.2.1 Authority codes", () => {
  it("describes every frozen code with an exhaustive switch", () => {
    const descriptions = AUTHORITY_CODES.map((code) => describeAuthorityCode(code));
    expect(AUTHORITY_CODES).toHaveLength(24);
    expect(descriptions.every((description) => description.length > 0)).toBe(true);
    const neverCode: AuthorityCode = AUTHORITY_CODES[0]!;
    expect(describeAuthorityCode(neverCode)).toBeTypeOf("string");
  });
});
