import { describe, expect, it } from "vitest";

import {
  HEATMAP_LEGEND_GRADIENT,
  heatmapCellColours,
} from "./holistic-challenge-category-heatmap-colours";

// Independent WCAG 2.x relative luminance and contrast ratio.
function relativeLuminance(colour: string) {
  const values = colour.startsWith("#")
    ? [1, 3, 5].map((start) => parseInt(colour.slice(start, start + 2), 16))
    : colour.match(/\d+/g)!.map(Number);
  const [red, green, blue] = values.map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string) {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// Every value a cell can show: 0.0% to 100.0% in 0.1 steps.
const PERCENTS = Array.from({ length: 1001 }, (_, index) => index / 10);

describe("heatmapCellColours", () => {
  it.each([
    [0, "rgb(255, 247, 188)", "#000000"],
    [25, "rgb(230, 185, 144)", "#000000"],
    [50, "rgb(204, 124, 101)", "#000000"],
    [62.5, "rgb(191, 93, 79)", "#000000"],
    [75, "rgb(179, 62, 57)", "#ffffff"],
    [100, "rgb(153, 0, 13)", "#ffffff"],
  ])("colours a %s%% cell %s with %s text", (percent, backgroundColor, color) => {
    expect(heatmapCellColours(percent)).toEqual({ backgroundColor, color });
  });

  it("gives every cell from 0% to 100% at least 4.5:1 text contrast", () => {
    const ratios = PERCENTS.map((percent) => {
      const { backgroundColor, color } = heatmapCellColours(percent);
      return contrastRatio(backgroundColor, color);
    });

    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  it("picks whichever of dark and white text contrasts more with each cell", () => {
    for (const percent of PERCENTS) {
      const { backgroundColor, color } = heatmapCellColours(percent);
      const other = color === "#ffffff" ? "#000000" : "#ffffff";
      expect(contrastRatio(backgroundColor, color)).toBeGreaterThanOrEqual(contrastRatio(backgroundColor, other));
    }
  });

  it("switches from dark to white text once, on the darker half of the scale", () => {
    const firstWhite = PERCENTS.find((percent) => heatmapCellColours(percent).color === "#ffffff")!;

    expect(firstWhite).toBeGreaterThan(60);
    expect(PERCENTS.filter((percent) => percent < firstWhite)
      .every((percent) => heatmapCellColours(percent).color === "#000000")).toBe(true);
    expect(PERCENTS.filter((percent) => percent >= firstWhite)
      .every((percent) => heatmapCellColours(percent).color === "#ffffff")).toBe(true);
  });
});

it("draws the legend across the same 0% and 100% colours as the cells", () => {
  expect(HEATMAP_LEGEND_GRADIENT).toBe(
    `linear-gradient(to right, ${heatmapCellColours(0).backgroundColor}, ${heatmapCellColours(100).backgroundColor})`,
  );
});
