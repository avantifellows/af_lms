// Client-safe colour scale for the Challenge Category Heatmap.

// Linear 0-100 scale: light yellow -> dark red.
const LOW = [255, 247, 188];
const HIGH = [153, 0, 13];

const rgb = (colour: number[]) => `rgb(${colour.join(", ")})`;

// WCAG relative luminance.
function luminance(colour: number[]) {
  const [red, green, blue] = colour.map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

// Below this luminance white text contrasts more than black. Black, not the
// app's grey text, keeps every cell on this scale >= 4.5:1.
const WHITE_TEXT_BELOW = Math.sqrt(1.05 * 0.05) - 0.05;

export const HEATMAP_LEGEND_GRADIENT = `linear-gradient(to right, ${rgb(LOW)}, ${rgb(HIGH)})`;

/** A cell's background on the scale, and whichever of black and white text contrasts with it more. */
export function heatmapCellColours(percent: number) {
  const background = LOW.map((low, index) => Math.round(low + (HIGH[index] - low) * (percent / 100)));
  return {
    backgroundColor: rgb(background),
    color: luminance(background) < WHITE_TEXT_BELOW ? "#ffffff" : "#000000",
  };
}
