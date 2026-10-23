// A picked Call Recording's length, read in the browser from the file's own
// metadata, so the log form can fill in Duration. Any failure (a codec the
// browser can't read, no metadata) is null and Duration stays as it was.

// The longest Duration the form takes, in minutes.
const MAX_DURATION_MINUTES = 240;
// Metadata is in the file's first bytes; past this the read has failed.
const METADATA_TIMEOUT_MS = 10_000;

// Whole minutes, at least 1; null when unknown or longer than the form takes.
export function recordingMinutes(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes > MAX_DURATION_MINUTES ? null : minutes;
}

export function readRecordingMinutes(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const audio = new Audio();
    const finish = (minutes: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(minutes);
    };
    const timer = setTimeout(() => finish(null), METADATA_TIMEOUT_MS);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(recordingMinutes(audio.duration));
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}
