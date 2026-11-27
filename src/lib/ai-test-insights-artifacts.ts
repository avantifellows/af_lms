// AI Test Insights (#550): the artifact reader. Server-only: it reads the
// read-only S3 key and the database (`@/lib/db`).
//
// AI Mentorship Guide writes each Test Insight to S3 and records its files in
// `acad_mentorship_inference_item_files` (db-service's table). The LMS finds a
// completed request's file through the request's `inference_item_id` and the
// file's `file_kind` (`report` for the Markdown text, `report_pdf` for the
// PDF), and reads it with its own S3 client and read-only key, separate from
// the documents client in `@/lib/s3`.
//
// All environments share one bucket, so before reading a key the reader
// checks that it starts with `{prefix}/{APP_ENV}/items/{item id}/`: that check
// is what stops a staging LMS from reading a production file, or one Item's
// request from reading another Item's file.
//
// Settings (a value blank after trimming counts as unset):
// - AI_TEST_INSIGHTS_S3_BUCKET, AI_TEST_INSIGHTS_S3_ACCESS_KEY_ID and
//   AI_TEST_INSIGHTS_S3_SECRET_ACCESS_KEY: required.
// - AI_TEST_INSIGHTS_S3_REGION: default `ap-south-1`.
// - AI_TEST_INSIGHTS_S3_PREFIX: default `acad-mentorship`.
// - AI_TEST_INSIGHTS_S3_ENDPOINT: only a local fake sets it (e2e and local
//   QA); the deploy workflow never passes it. With it, path-style addressing.
// - APP_ENV: `staging` or `production`, the environment folder of the keys.
//
// Logs carry the request key, `student.id`, a reason and an error name only,
// never the text or an S3 key.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { aiTestInsightsEnvironment, aiTestInsightsSetting, errorName, type AiTestInsightsEnvironment } from "@/lib/ai-test-insights-env";
import { query } from "@/lib/db";

/** How long a presigned PDF URL lasts: 60 seconds, as the document downloads. */
const TEST_INSIGHT_PDF_URL_TTL_SECONDS = 60;

/** The largest Test Insight text the LMS returns: 1 MB. */
const TEST_INSIGHT_TEXT_MAX_BYTES = 1024 * 1024;

interface AiTestInsightsArtifactSettings {
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Only a local fake sets it; null reads from AWS. */
  endpoint: string | null;
  environment: AiTestInsightsEnvironment;
}

/** The reader's settings, or null when reading is not configured. */
function aiTestInsightsArtifactSettings(): AiTestInsightsArtifactSettings | null {
  const bucket = aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_BUCKET");
  const accessKeyId = aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_ACCESS_KEY_ID");
  const secretAccessKey = aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_SECRET_ACCESS_KEY");
  const environment = aiTestInsightsEnvironment();
  if (!bucket || !accessKeyId || !secretAccessKey || !environment) return null;
  return {
    bucket,
    region: aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_REGION") ?? "ap-south-1",
    prefix: (aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_PREFIX") ?? "acad-mentorship").replace(/^\/+|\/+$/g, ""),
    accessKeyId,
    secretAccessKey,
    endpoint: aiTestInsightsSetting("AI_TEST_INSIGHTS_S3_ENDPOINT"),
    environment,
  };
}

let cached: { signature: string; client: S3Client } | null = null;

/** The reader's own S3 client, made again whenever its settings change. */
function artifactClient(settings: AiTestInsightsArtifactSettings): S3Client {
  const signature = JSON.stringify([
    settings.region,
    settings.endpoint,
    settings.accessKeyId,
    settings.secretAccessKey,
  ]);
  if (cached?.signature !== signature) {
    cached = {
      signature,
      client: new S3Client({
        region: settings.region,
        credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
        ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
      }),
    };
  }
  return cached.client;
}

/**
 * Whether a key lies inside the Item's folder of this environment:
 * `{prefix}/{environment}/items/{item id}/`, with no `.` or `..` segment.
 */
function isKeyInItemFolder(settings: AiTestInsightsArtifactSettings, itemId: string, key: string): boolean {
  const folder = `${settings.prefix}/${settings.environment}/items/${itemId}/`;
  if (!key.startsWith(folder)) return false;
  return key
    .slice(folder.length)
    .split("/")
    .every((segment) => segment !== "." && segment !== "..");
}

/** The kinds of Item File the LMS reads. */
type InsightFileKind = "report" | "report_pdf";

/**
 * The file of one kind of a completed request of the Student, found through
 * the request's `inference_item_id`; null when the request is not that
 * Student's, is not completed, or its Item has no such file.
 */
async function insightFile(
  studentId: number,
  requestKey: string,
  fileKind: InsightFileKind,
): Promise<{ itemId: string; s3Key: string } | null> {
  const rows = await query<{ item_id: string | number; s3_key: string }>(
    `SELECT f.item_id, f.s3_key
     FROM ai_test_insight_requests r
     JOIN acad_mentorship_inference_item_files f ON f.item_id = r.inference_item_id
     WHERE r.student_id = $1 AND r.request_key = $2 AND f.file_kind = $3 AND r.state = 'completed'
     ORDER BY f.id DESC
     LIMIT 1`,
    [studentId, requestKey, fileKind],
  );
  return rows[0] ? { itemId: String(rows[0].item_id), s3Key: rows[0].s3_key } : null;
}

export type TestInsightTextRead =
  | { status: "read"; markdown: string }
  | { status: "not_configured" }
  | { status: "no_file" }
  | { status: "unreadable"; reason: "outside_prefix" | "too_large" | "store_failed"; errorName?: string };

/**
 * The Test Insight text (Markdown) of a completed request of the Student.
 * Unreadable when the key fails the folder check (not read at all), the text
 * is larger than 1 MB, or the store read fails.
 */
export async function readTestInsightText(studentId: number, requestKey: string): Promise<TestInsightTextRead> {
  const settings = aiTestInsightsArtifactSettings();
  if (!settings) return { status: "not_configured" };

  const file = await insightFile(studentId, requestKey, "report");
  if (!file) return { status: "no_file" };
  if (!isKeyInItemFolder(settings, file.itemId, file.s3Key)) return { status: "unreadable", reason: "outside_prefix" };

  try {
    const object = await artifactClient(settings).send(
      new GetObjectCommand({ Bucket: settings.bucket, Key: file.s3Key }),
    );
    if (!object.Body) return { status: "unreadable", reason: "store_failed", errorName: "EmptyBody" };
    if ((object.ContentLength ?? 0) > TEST_INSIGHT_TEXT_MAX_BYTES) {
      return { status: "unreadable", reason: "too_large" };
    }
    const bytes = await object.Body.transformToByteArray();
    if (bytes.byteLength > TEST_INSIGHT_TEXT_MAX_BYTES) return { status: "unreadable", reason: "too_large" };
    return { status: "read", markdown: new TextDecoder().decode(bytes) };
  } catch (error) {
    return { status: "unreadable", reason: "store_failed", errorName: errorName(error) };
  }
}

export type TestInsightPdfSign =
  | { status: "signed"; url: string }
  | { status: "not_configured" }
  | { status: "no_file" }
  | { status: "unreadable"; reason: "outside_prefix" | "sign_failed"; errorName?: string };

/**
 * A 60-second presigned URL of the PDF of a completed request of the
 * Student, which the browser saves as `fileName`. Not signed when the key
 * fails the folder check.
 */
export async function presignTestInsightPdf(
  studentId: number,
  requestKey: string,
  fileName: string,
): Promise<TestInsightPdfSign> {
  const settings = aiTestInsightsArtifactSettings();
  if (!settings) return { status: "not_configured" };

  const file = await insightFile(studentId, requestKey, "report_pdf");
  if (!file) return { status: "no_file" };
  if (!isKeyInItemFolder(settings, file.itemId, file.s3Key)) return { status: "unreadable", reason: "outside_prefix" };

  try {
    const url = await getSignedUrl(
      artifactClient(settings),
      new GetObjectCommand({
        Bucket: settings.bucket,
        Key: file.s3Key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      }),
      { expiresIn: TEST_INSIGHT_PDF_URL_TTL_SECONDS },
    );
    return { status: "signed", url };
  } catch (error) {
    return { status: "unreadable", reason: "sign_failed", errorName: errorName(error) };
  }
}
