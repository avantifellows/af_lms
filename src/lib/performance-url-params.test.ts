import { describe, it, expect } from "vitest";
import {
  applyPerformanceParams,
  readPerformanceParams,
} from "./performance-url-params";

const read = (qs: string) => readPerformanceParams(new URLSearchParams(qs));
const apply = (qs: string, patch: Parameters<typeof applyPerformanceParams>[1]) =>
  new URLSearchParams(applyPerformanceParams(new URLSearchParams(qs), patch));

describe("readPerformanceParams", () => {
  it("reads every filter off the query string", () => {
    expect(
      read(
        "program=JNV+CoE&grade=12&session=s-1&stream=pcm&subject=Physics&testGrade=11&view=cumulative&category=chapter"
      )
    ).toEqual({
      program: "JNV CoE",
      grade: 12,
      session: "s-1",
      stream: "pcm",
      subject: "Physics",
      testGrade: 11,
      view: "cumulative",
      category: "chapter",
    });
  });

  it("falls back to the defaults the tab opens on", () => {
    expect(read("")).toEqual({
      program: null,
      grade: null,
      session: null,
      stream: null,
      subject: null,
      testGrade: null,
      view: "per_test",
      category: "full",
    });
  });

  it("treats an unrecognised view or category as the default", () => {
    const state = read("view=sideways&category=nonsense");
    expect(state.view).toBe("per_test");
    expect(state.category).toBe("full");
  });

  // A hand-edited or truncated link must not put NaN into the analytics queries.
  it("reads a non-numeric grade as absent rather than NaN", () => {
    expect(read("grade=twelve&testGrade=").grade).toBeNull();
    expect(read("grade=twelve&testGrade=abc").testGrade).toBeNull();
  });
});

describe("applyPerformanceParams", () => {
  it("sets the params it is given", () => {
    const out = apply("", { program: "JNV CoE", grade: 12, stream: "pcm" });
    expect(out.get("program")).toBe("JNV CoE");
    expect(out.get("grade")).toBe("12");
    expect(out.get("stream")).toBe("pcm");
  });

  it("deletes a param set to null, and leaves absent keys alone", () => {
    const out = apply("program=JNV+CoE&grade=12&stream=pcm", { stream: null });
    expect(out.has("stream")).toBe(false);
    // Untouched keys survive — that's what makes partial updates safe.
    expect(out.get("program")).toBe("JNV CoE");
    expect(out.get("grade")).toBe("12");
  });

  it("keeps the defaults out of the URL so links stay clean", () => {
    const out = apply("view=cumulative&category=chapter", {
      view: "per_test",
      category: "full",
    });
    expect(out.has("view")).toBe(false);
    expect(out.has("category")).toBe(false);
  });

  it("carries non-default view and category", () => {
    const out = apply("", { view: "cumulative", category: "chapter" });
    expect(out.get("view")).toBe("cumulative");
    expect(out.get("category")).toBe("chapter");
  });

  it("preserves params the Performance tab does not own", () => {
    const out = apply("tab=performance&grade=11", { grade: 12 });
    expect(out.get("tab")).toBe("performance");
    expect(out.get("grade")).toBe("12");
  });

  it("clears an empty string like an absent value", () => {
    const out = apply("stream=pcm&subject=Physics", { stream: "", subject: "" });
    expect(out.has("stream")).toBe(false);
    expect(out.has("subject")).toBe(false);
  });

  // The round trip is the real contract: whatever we write, we must read back.
  it("round-trips a full state through write then read", () => {
    const written = applyPerformanceParams("", {
      program: "JNV CoE",
      grade: 12,
      session: "s-1",
      stream: "pcm",
      subject: "Physics",
      testGrade: 11,
      view: "cumulative",
      category: "chapter",
    });
    expect(readPerformanceParams(new URLSearchParams(written))).toEqual({
      program: "JNV CoE",
      grade: 12,
      session: "s-1",
      stream: "pcm",
      subject: "Physics",
      testGrade: 11,
      view: "cumulative",
      category: "chapter",
    });
  });
});
