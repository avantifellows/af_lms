import { describe, expect, it } from "vitest";

import { fuzzyMatch } from "./fuzzy-match";

describe("fuzzyMatch", () => {
  it("matches single token substring", () => {
    expect(fuzzyMatch("ali", "Alice Student")).toBe(true);
  });

  it("matches multiple tokens (all must be substrings)", () => {
    expect(fuzzyMatch("ram kum", "Ramesh Kumar")).toBe(true);
  });

  it("fails when one token is missing", () => {
    expect(fuzzyMatch("ram xyz", "Ramesh Kumar")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("ALICE", "alice student")).toBe(true);
    expect(fuzzyMatch("alice", "ALICE STUDENT")).toBe(true);
  });

  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "Alice Student")).toBe(true);
    expect(fuzzyMatch("   ", "Alice Student")).toBe(true);
  });

  it("returns false for null candidate", () => {
    expect(fuzzyMatch("alice", null)).toBe(false);
  });

  it("returns false for undefined candidate", () => {
    expect(fuzzyMatch("alice", undefined)).toBe(false);
  });

  it("returns false for empty candidate with non-empty query", () => {
    expect(fuzzyMatch("alice", "")).toBe(false);
  });

  it("matches student_id style strings", () => {
    expect(fuzzyMatch("STU00", "STU001")).toBe(true);
    expect(fuzzyMatch("002", "STU002")).toBe(true);
  });

  it("matches tokens in any order", () => {
    expect(fuzzyMatch("kumar ram", "Ramesh Kumar")).toBe(true);
  });
});
