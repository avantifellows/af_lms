import { randomUUID } from "node:crypto";

import {
  canAccessBlendedStudent,
  canBlendedLearning,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import { blendedLearningPhotoPrefix, extensionFor, headObject, uploadObject } from "./s3";

// Conversation photos (server-only). The browser downscales each image, then
// uploads it here, one per request; the entries request then references the
// returned keys. Objects from abandoned forms are left in S3 in v1.

export const MAX_CONVERSATION_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};
// The part of a photo key after the Student's prefix: `{uuid}.{ext}`.
const PHOTO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic)$/;

export type UploadedPhoto = { s3Key: string; contentType: string; byteSize: number };

export type UploadPhotoResult =
  | { ok: true; photo: UploadedPhoto }
  | { ok: false; status: 403 | 404 | 422; error: string };

export async function uploadConversationPhoto(
  access: BlendedLearningAccess,
  studentId: number,
  file: Blob
): Promise<UploadPhotoResult> {
  if (!canBlendedLearning(access, "upload")) return { ok: false, status: 403, error: "Forbidden" };
  if (!(await canAccessBlendedStudent(access, studentId))) return { ok: false, status: 404, error: "Not found" };
  if (!PHOTO_TYPES.has(file.type)) {
    return { ok: false, status: 422, error: "Choose a JPEG, PNG, WebP or HEIC image." };
  }
  if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
    return { ok: false, status: 422, error: "A photo must be 10 MB or smaller." };
  }

  const s3Key = `${blendedLearningPhotoPrefix(studentId)}${randomUUID()}.${extensionFor(file.type)}`;
  await uploadObject({ s3Key, body: Buffer.from(await file.arrayBuffer()), contentType: file.type });
  return { ok: true, photo: { s3Key, contentType: file.type, byteSize: file.size } };
}

// The content type a photo was stored with, or null for a key that is not
// under this Student's photo prefix.
export function photoKeyContentType(studentId: number, key: unknown): string | null {
  const prefix = blendedLearningPhotoPrefix(studentId);
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const match = PHOTO_FILE.exec(key.slice(prefix.length));
  return match ? EXTENSION_TYPES[match[1]] : null;
}

// The stored size of each uploaded photo, in order; null where no object exists.
export async function uploadedPhotoSizes(keys: string[]): Promise<(number | null)[]> {
  return Promise.all(keys.map(async (key) => (await headObject(key))?.byteSize ?? null));
}
