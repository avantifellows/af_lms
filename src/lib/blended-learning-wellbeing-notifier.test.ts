import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { notifyWellbeingFlag } from "./blended-learning-wellbeing-notifier";

const mockQuery = vi.mocked(query);
const ses = mockClient(SESClient);

const SUMMARY = "Synthetic summary: she has been anxious before the mock test.";
const NOTES_TEXT = "Synthetic notes: trouble sleeping since the hostel move.";
const COMMENT = "Synthetic comment: please call her this week.";

// The flag table, by id, with every column the notifier could read, including
// the Conversation's summary and notes, which must never reach the email.
let flags: Record<number, Record<string, unknown>>;

function givenFlags() {
  flags = {
    41: {
      id: 41,
      recipient: "emotional_wellbeing",
      comment: COMMENT,
      raised_by_email: "faizan@avantifellows.org",
      student_id: 501,
      student_first_name: "Ira",
      student_last_name: "Sharma",
      grade: 12,
      program_name: "STP Voucher Delhi",
      mentor_first_name: "Faizan",
      mentor_last_name: "Khan",
      mentor_email: "faizan@avantifellows.org",
      occurred_on: "2026-10-21",
      summary: SUMMARY,
      notes_html: `<h3>Well-being</h3><ul><li>${NOTES_TEXT}</li></ul>`,
    },
    42: {
      id: 42,
      recipient: "physics",
      comment: "Synthetic: struggling with rotation.",
      raised_by_email: "faizan@avantifellows.org",
      student_id: 501,
      student_first_name: "Ira",
      student_last_name: "Sharma",
      grade: 12,
      program_name: "STP Voucher Delhi",
      mentor_first_name: "Faizan",
      mentor_last_name: "Khan",
      mentor_email: "faizan@avantifellows.org",
      occurred_on: "2026-10-21",
      summary: SUMMARY,
      notes_html: null,
    },
  };
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const id = Number(params?.[0]);
    if (sql.includes("FROM blended_learning_mentor_flags")) {
      return flags[id] ? [{ ...flags[id] }] : [];
    }
    return [];
  });
}

const ENV = {
  BLENDED_LEARNING_SES_ACCESS_KEY_ID: "AKIATEST",
  BLENDED_LEARNING_SES_SECRET_ACCESS_KEY: "test-secret",
  BLENDED_LEARNING_WELLBEING_EMAILS: " shalinijha@avantifellows.org, wellbeing-backup@avantifellows.org ",
  NEXTAUTH_URL: "https://lms.avantifellows.org/",
};

function sentEmails() {
  return ses.commandCalls(SendEmailCommand).map((call) => call.args[0].input);
}

beforeEach(() => {
  vi.clearAllMocks();
  ses.reset();
  ses.on(SendEmailCommand).resolves({ MessageId: "ses-message-1" });
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  vi.stubEnv("BLENDED_LEARNING_SES_REGION", "");
  givenFlags();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("notifyWellbeingFlag", () => {
  it("emails the well-being lead from no-reply with the Student, grade, program, Mentor, date and link", async () => {
    expect(await notifyWellbeingFlag(41)).toBe("sent");

    const emails = sentEmails();
    expect(emails).toHaveLength(1);
    const [email] = emails;
    expect(email.Source).toBe("no-reply@avantifellows.org");
    expect(email.Destination?.ToAddresses).toEqual([
      "shalinijha@avantifellows.org",
      "wellbeing-backup@avantifellows.org",
    ]);
    expect(email.Message?.Subject?.Data).toContain("Ira Sharma");
    const body = email.Message?.Body?.Text?.Data ?? "";
    expect(body).toContain("Student: Ira Sharma");
    expect(body).toContain("Grade: 12");
    expect(body).toContain("Program: STP Voucher Delhi");
    expect(body).toContain("Mentor: Faizan Khan");
    expect(body).toContain("Date: 21 Oct 2026");
    expect(body).toContain("https://lms.avantifellows.org/blended-learning/students/501");
  });

  it("never puts the summary, notes or comment in the email", async () => {
    await notifyWellbeingFlag(41);

    const [email] = sentEmails();
    const everything = JSON.stringify(email);
    expect(everything).not.toContain(SUMMARY);
    expect(everything).not.toContain(NOTES_TEXT);
    expect(everything).not.toContain(COMMENT);
  });

  it("only reads the flag: it writes nothing back", async () => {
    expect(await notifyWellbeingFlag(41)).toBe("sent");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/^\s*SELECT/);
  });

  it("sends nothing for a Physics, Chemistry or Maths flag or an unknown id", async () => {
    expect(await notifyWellbeingFlag(42)).toBe("skipped");
    expect(await notifyWellbeingFlag(999)).toBe("skipped");
    expect(sentEmails()).toEqual([]);
  });

  it("logs an SES failure without PII and does not throw", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    ses.on(SendEmailCommand).rejects(
      Object.assign(new Error("Email address is not verified: shalinijha@avantifellows.org, Ira Sharma"), {
        name: "MessageRejected",
      })
    );

    expect(await notifyWellbeingFlag(41)).toBe("failed");

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("MessageRejected");
    for (const pii of ["Ira", "Sharma", "shalinijha", "faizan", COMMENT, SUMMARY]) {
      expect(logged).not.toContain(pii);
    }
    consoleError.mockRestore();
  });

  it.each([
    ["BLENDED_LEARNING_SES_ACCESS_KEY_ID", undefined],
    ["BLENDED_LEARNING_SES_SECRET_ACCESS_KEY", undefined],
    ["BLENDED_LEARNING_WELLBEING_EMAILS", undefined],
    ["BLENDED_LEARNING_WELLBEING_EMAILS", " , "],
    // e2e sets a blank-looking value so .env.local cannot refill it.
    ["BLENDED_LEARNING_SES_ACCESS_KEY_ID", " "],
  ])("skips with no SES call and no error when %s is %j", async (name, value) => {
    vi.stubEnv(name, value);
    expect(await notifyWellbeingFlag(41)).toBe("skipped");
    expect(ses.calls()).toHaveLength(0);
  });

  it("sends through ap-south-1 unless BLENDED_LEARNING_SES_REGION says otherwise", async () => {
    await notifyWellbeingFlag(41);
    expect(await ses.call(0).thisValue.config.region()).toBe("ap-south-1");

    vi.stubEnv("BLENDED_LEARNING_SES_REGION", "us-east-1");
    await notifyWellbeingFlag(41);
    expect(await ses.call(1).thisValue.config.region()).toBe("us-east-1");
  });
});
