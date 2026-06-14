import { describe, it, expect } from "vitest";
import { normalizeEmail, hashCode } from "../otp";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmail("already@lower.dev")).toBe("already@lower.dev");
  });
});

describe("hashCode (OTP crypto contract)", () => {
  it("is deterministic and produces a 64-char hex SHA-256 digest", () => {
    const h1 = hashCode("user@example.com", "123456");
    const h2 = hashCode("user@example.com", "123456");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the hash to the email (same code, different address -> different hash)", () => {
    expect(hashCode("a@example.com", "123456")).not.toBe(
      hashCode("b@example.com", "123456"),
    );
  });

  it("binds the hash to the code (same address, different code -> different hash)", () => {
    expect(hashCode("user@example.com", "123456")).not.toBe(
      hashCode("user@example.com", "654321"),
    );
  });

  it("never returns the plaintext code", () => {
    const h = hashCode("user@example.com", "123456");
    expect(h).not.toContain("123456");
  });
});
