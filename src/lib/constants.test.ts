import { describe, it, expect } from "vitest";
import { JNV_NVS_PROGRAM_ID } from "./constants";

describe("constants", () => {
  it("JNV_NVS_PROGRAM_ID is 64", () => {
    expect(JNV_NVS_PROGRAM_ID).toBe(64);
  });
});
