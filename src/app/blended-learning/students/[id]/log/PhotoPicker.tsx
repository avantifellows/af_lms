"use client";

import { useId, useRef, type ChangeEvent, type Dispatch, type SetStateAction } from "react";

import { downscaleImage } from "@/lib/image-resize";

// Up to five photos on a Conversation. Each is downscaled in the browser and
// uploaded on its own as soon as it is picked; the form then sends the
// uploaded keys with the Conversation. The form owns the list, so switching
// to an Attempt and back keeps it.

const MAX_PHOTOS = 5;

export type PickedPhoto = {
  id: number;
  // The downscaled image, once ready.
  previewUrl: string | null;
  status: "uploading" | "done" | "failed";
  s3Key?: string;
  error?: string;
};

export function PhotoPicker({
  studentId,
  photos,
  setPhotos,
  errors,
}: {
  studentId: number;
  photos: PickedPhoto[];
  setPhotos: Dispatch<SetStateAction<PickedPhoto[]>>;
  // Server errors: `photoKeys`, or `photoKeys.N` for the Nth uploaded photo sent.
  errors: Record<string, string>;
}) {
  const inputId = useId();
  const nextId = useRef(1);

  function update(id: number, change: Partial<PickedPhoto>) {
    setPhotos((current) => current.map((photo) => (photo.id === id ? { ...photo, ...change } : photo)));
  }

  async function addPhoto(file: File, id: number) {
    let blob: Blob;
    try {
      blob = await downscaleImage(file);
    } catch {
      update(id, {
        status: "failed",
        error:
          file.type === "image/heic"
            ? "This phone can't open HEIC photos here. Share the photo as JPEG and add it again."
            : "Couldn't open this image.",
      });
      return;
    }
    update(id, { previewUrl: URL.createObjectURL(blob) });
    const body = new FormData();
    body.append("photo", blob, "photo.jpg");
    try {
      const res = await fetch(`/api/blended-learning/students/${studentId}/photos`, { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (res.ok) update(id, { status: "done", s3Key: json.s3Key });
      else update(id, { status: "failed", error: json.error ?? "Couldn't upload this photo." });
    } catch {
      update(id, { status: "failed", error: "Couldn't upload this photo. Check your connection." });
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, MAX_PHOTOS - photos.length);
    event.target.value = "";
    // Reserve each slot before the async downscale, so the limit holds.
    const added = files.map((file) => ({ file, id: nextId.current++ }));
    setPhotos((current) => [
      ...current,
      ...added.map(({ id }) => ({ id, previewUrl: null, status: "uploading" as const })),
    ]);
    for (const { file, id } of added) void addPhoto(file, id);
  }

  function remove(photo: PickedPhoto) {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
  }

  // Index of each uploaded photo among those sent, for `photoKeys.N` errors.
  const sentIndex = new Map(photos.filter((photo) => photo.status === "done").map((photo, index) => [photo.id, index]));

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">Photos (optional)</legend>
      <p className="text-xs text-text-secondary">{`${photos.length} of ${MAX_PHOTOS} photos`}</p>
      {photos.length > 0 && (
        <ul aria-label="Attached photos" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {photos.map((photo, index) => {
            const serverError = sentIndex.has(photo.id) ? errors[`photoKeys.${sentIndex.get(photo.id)}`] : undefined;
            const error = photo.error ?? serverError;
            return (
              <li key={photo.id} className="min-w-0 space-y-1">
                {photo.previewUrl ? (
                  // Local object URLs; next/image can't optimise them.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.previewUrl}
                    alt={`Photo ${index + 1}`}
                    className="aspect-square w-full rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-md border border-border bg-hover-bg" />
                )}
                {photo.status === "uploading" && <p className="text-xs text-text-muted">Uploading…</p>}
                {error && <p className="text-xs text-danger">{error}</p>}
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  aria-label={`Remove photo ${index + 1}`}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-bg-card px-3 text-sm font-bold text-text-primary hover:bg-hover-bg"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {photos.length < MAX_PHOTOS ? (
        <label
          htmlFor={inputId}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-card px-4 text-sm font-bold text-text-primary shadow-sm hover:bg-hover-bg focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:w-auto"
        >
          Add photo
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            onChange={onPick}
            className="sr-only"
          />
        </label>
      ) : (
        <p className="text-sm text-text-secondary">Five photos is the most a Conversation can have.</p>
      )}
      {errors.photoKeys && <p className="mt-1 text-sm text-danger">{errors.photoKeys}</p>}
    </fieldset>
  );
}
