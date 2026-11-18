// Guards against an invisible colour on the Test Attendance tab (#517 QA): a
// Tailwind class such as `bg-warning` names a colour the theme does not define,
// so Tailwind emits nothing and the element renders transparent or in the body
// colour. Every colour class (and `var(--color-…)`) in the tab's components that
// names one of the theme's own colour families must name a defined token, and
// none may use Tailwind's built-in palette (`text-white`, `bg-red-600`): the tab
// uses theme tokens only. The tokens are read from globals.css, not listed here.
import { readdirSync, readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const COMPONENTS = path.join(ROOT, "src/components/test-attendance");

/** The `--color-*` names mapped in globals.css's `@theme inline` block. */
function themeColours(): Set<string> {
  const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const block = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("No @theme inline block in src/app/globals.css");
  return new Set([...block[1].matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

const UTILITY = /^(?:bg|text|border(?:-[xytrbl])?|fill|stroke|ring|outline|divide|decoration|from|via|to|shadow|accent|caret|placeholder)-(.+)$/;

/** Tailwind's built-in colours, which carry no theme token. */
const PALETTE =
  /^(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?)$/;

/** Colour names a component refers to: the theme's families (warning, success, accent, …) and Tailwind's palette. */
function referencedColours(source: string, families: Set<string>): string[] {
  const names = new Set<string>();
  for (const token of source.split(/[\s"'`{}()<>,;]+/)) {
    // Drop variants (hover:, md:) and an opacity suffix (/90).
    const utility = token.slice(token.lastIndexOf(":") + 1).split("/")[0];
    const match = utility.match(UTILITY);
    if (match && (families.has(match[1].split("-")[0]) || PALETTE.test(match[1]))) names.add(match[1]);
  }
  for (const match of source.matchAll(/var\(--color-([a-z0-9-]+)\)/g)) names.add(match[1]);
  return [...names];
}

describe("Test Attendance colour classes", () => {
  const colours = themeColours();
  const families = new Set([...colours].map((name) => name.split("-")[0]));
  const files = readdirSync(COMPONENTS).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));

  it("reads the theme and finds the components", () => {
    expect(colours).toContain("warning-border");
    expect(families).toContain("warning");
    expect(files).toContain("MonthPage.tsx");
  });

  it("flags a colour class the theme does not define", () => {
    expect(referencedColours('className="bg-warning hover:text-warning-text/80"', families)).toEqual([
      "warning",
      "warning-text",
    ]);
  });

  it("flags Tailwind's own palette colours, and leaves sizes and other utilities alone", () => {
    const names = referencedColours('className="text-white bg-red-600/90 border-l-4 text-xs text-[11px] border-dashed"', families);
    expect(names).toEqual(["white", "red-600"]);
    expect(names.filter((name) => !colours.has(name))).toEqual(["white", "red-600"]);
  });

  it.each(files)("%s names only colours the theme defines", (file) => {
    const source = readFileSync(path.join(COMPONENTS, file), "utf8");
    const missing = referencedColours(source, families).filter((name) => !colours.has(name));
    expect(missing).toEqual([]);
  });
});
