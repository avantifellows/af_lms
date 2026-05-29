// Client-side image downscale before upload. Keeps the on-the-wire payload
// small (~500 KB instead of 4–8 MB phone-camera raw), which matters for both
// the Lambda body cap and mobile data usage.
//
// Output is always JPEG — even if the input is PNG/WebP/HEIC — because the
// downstream consumer treats pages as photos, not as artwork that needs an
// alpha channel.
//
// HEIC caveat: Safari iOS can decode HEIC into a canvas natively, but Chrome
// Android cannot. If `Image.onerror` fires we let the caller decide whether
// to retry via a HEIC→JPEG library or upload the raw file.

const DEFAULT_MAX_DIM = 1500;
const DEFAULT_QUALITY = 0.8;

export interface DownscaleOptions {
  maxDim?: number;
  quality?: number;
}

export async function downscaleImage(
  file: File,
  opts: DownscaleOptions = {},
): Promise<Blob> {
  const { maxDim = DEFAULT_MAX_DIM, quality = DEFAULT_QUALITY } = opts;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, maxDim);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    ctx.drawImage(img, 0, 0, width, height);

    return await canvasToBlob(canvas, quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function scaledDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxDim: number,
): { width: number; height: number } {
  // Pass-through when already within target — avoids losing quality on a
  // re-encode that wouldn't shrink anything.
  if (naturalWidth <= maxDim && naturalHeight <= maxDim) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = naturalWidth >= naturalHeight ? maxDim / naturalWidth : maxDim / naturalHeight;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob returned null"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

// Exported for tests — pure scaling math without the canvas dependency.
export const __test__ = { scaledDimensions };
