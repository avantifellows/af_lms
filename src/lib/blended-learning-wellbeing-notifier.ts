import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

import { query } from "./db";

// Well-being notifier (server-only). After a Conversation with an Emotional
// Well-being Mentor Flag commits, notifyWellbeingFlag emails the well-being
// lead once: the Student, grade, program, Mentor, date and a link, never the
// summary, notes or comment. Best-effort: it never throws, a failure is logged
// without PII, and there is no retry in v1. It is skipped when SES or the
// recipients are not configured, as in local and e2e runs.

const FROM_ADDRESS = "no-reply@avantifellows.org";

export type WellbeingNotifyOutcome = "sent" | "skipped" | "failed";

type SesConfig = { accessKeyId: string; secretAccessKey: string; region: string; recipients: string[] };

function sesConfig(): SesConfig | null {
  const accessKeyId = process.env.BLENDED_LEARNING_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BLENDED_LEARNING_SES_SECRET_ACCESS_KEY?.trim();
  const recipients = (process.env.BLENDED_LEARNING_WELLBEING_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  if (!accessKeyId || !secretAccessKey || recipients.length === 0) return null;
  const region = process.env.BLENDED_LEARNING_SES_REGION?.trim() || "ap-south-1";
  return { accessKeyId, secretAccessKey, region, recipients };
}

// Only what the email may say about the flag: no comment, summary or notes.
type FlagEmailRow = {
  recipient: string;
  notification_sent_at: string | null;
  student_id: number | string;
  student_first_name: string | null;
  student_last_name: string | null;
  grade: number | string | null;
  program_name: string | null;
  mentor_first_name: string | null;
  mentor_last_name: string | null;
  mentor_email: string | null;
  occurred_on: string;
};

async function readFlag(flagId: number): Promise<FlagEmailRow | null> {
  const rows = await query<FlagEmailRow>(
    `SELECT flag.recipient, flag.notification_sent_at, flag.student_id,
            account.first_name AS student_first_name, account.last_name AS student_last_name,
            current_grade.number AS grade, program.name AS program_name,
            mentor.first_name AS mentor_first_name, mentor.last_name AS mentor_last_name,
            mentor.email AS mentor_email, c.occurred_on::text AS occurred_on
     FROM blended_learning_mentor_flags flag
     JOIN blended_learning_conversations c ON c.id = flag.conversation_id
     JOIN student st ON st.id = flag.student_id
     JOIN "user" account ON account.id = st.user_id
     LEFT JOIN program ON program.id = c.program_id
     LEFT JOIN "user" mentor ON mentor.id = c.mentor_user_id
     LEFT JOIN LATERAL (
       SELECT grade.number
       FROM enrollment_record er
       JOIN grade ON grade.id = er.group_id
       WHERE er.user_id = account.id AND er.group_type = 'grade' AND er.is_current IS TRUE
       ORDER BY er.updated_at DESC NULLS LAST, er.id DESC
       LIMIT 1
     ) current_grade ON true
     WHERE flag.id = $1`,
    [flagId]
  );
  return rows[0] ?? null;
}

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ");
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function composeEmail(flag: FlagEmailRow): { subject: string; body: string } {
  const student = fullName(flag.student_first_name, flag.student_last_name) || `Student ${flag.student_id}`;
  const mentor = fullName(flag.mentor_first_name, flag.mentor_last_name) || flag.mentor_email || "Unknown";
  const baseUrl = (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
  const link = `${baseUrl}/blended-learning/students/${flag.student_id}`;
  return {
    subject: `Emotional Well-being flag: ${student}`,
    body: [
      "A Blended Learning Mentor raised an Emotional Well-being flag on a Conversation.",
      "",
      `Student: ${student}`,
      `Grade: ${flag.grade ?? "Not recorded"}`,
      `Program: ${flag.program_name ?? "Not recorded"}`,
      `Mentor: ${mentor}`,
      `Date: ${formatDate(flag.occurred_on)}`,
      "",
      `Open the Student's page in the LMS: ${link}`,
    ].join("\n"),
  };
}

export async function notifyWellbeingFlag(flagId: number): Promise<WellbeingNotifyOutcome> {
  const config = sesConfig();
  if (!config) return "skipped";
  try {
    const flag = await readFlag(flagId);
    if (!flag || flag.recipient !== "emotional_wellbeing" || flag.notification_sent_at !== null) return "skipped";

    const { subject, body } = composeEmail(flag);
    const ses = new SESClient({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    await ses.send(
      new SendEmailCommand({
        Source: FROM_ADDRESS,
        Destination: { ToAddresses: config.recipients },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: body, Charset: "UTF-8" } },
        },
      })
    );
    await query(
      `UPDATE blended_learning_mentor_flags
       SET notification_sent_at = now()
       WHERE id = $1 AND notification_sent_at IS NULL
       RETURNING id`,
      [flagId]
    );
    return "sent";
  } catch (error) {
    // Never the Student, recipients, body or error message: only the flag id
    // and the error's name.
    console.error("[blended-learning] well-being flag email failed", {
      flagId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return "failed";
  }
}
