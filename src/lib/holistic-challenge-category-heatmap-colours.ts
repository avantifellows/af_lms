// Client-safe colour scale for the Challenge Category Heatmap.

type Rgb = readonly number[];

// Linear 0-100 scale: light yellow -> dark red.
const LOW: Rgb = [255, 247, 188];
const HIGH: Rgb = [153, 0, 13];

// Dark cell text is black: with the app's grey text (#1f2937) the better of
// dark/white falls to 3.8:1 around 58%, while black keeps every cell >= 4.5:1.
const DARK_TEXT: Rgb = [0, 0, 0];
const WHITE_TEXT: Rgb = [255, 255, 255];

const rgb = (colour: Rgb) => `rgb(${colour.join(", ")})`;
const hex = (colour: Rgb) => `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

function channel(value: number) {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: Rgb) {
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

// WCAG contrast ratio between two colours.
function contrast(first: Rgb, second: Rgb) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export const HEATMAP_LEGEND_GRADIENT = `linear-gradient(to right, ${rgb(LOW)}, ${rgb(HIGH)})`;

/** A cell's background on the scale, and whichever text colour contrasts with it more. */
export function heatmapCellColours(percent: number) {
  const background = LOW.map((low, index) => Math.round(low + (HIGH[index] - low) * (percent / 100)));
  const text = contrast(WHITE_TEXT, background) > contrast(DARK_TEXT, background) ? WHITE_TEXT : DARK_TEXT;
  return { backgroundColor: rgb(background), color: hex(text) };
}
