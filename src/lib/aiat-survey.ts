// Routing for the AIAT post-test feedback survey. When a new-CMS AIAT session is created,
// the student should see a short feedback survey BEFORE their scorecard. There are three
// such surveys, picked by the student's program group and stream:
//   - EMRS students, engineering stream -> the full EMRS survey with PCM subjects
//   - EMRS students, medical stream     -> the full EMRS survey with PCB subjects
//   - every other EnableStudents AIAT   -> a short report-only survey
//
// "AIAT" is not a first-class CMS concept — it is a test-name convention — so we detect it
// from the CMS test name. The three survey quizzes are pre-created form sessions in the quiz
// engine; their ids are fixed, so they live here as constants (change a survey => change a
// constant). The quiz-backend /quiz/from-cms ingest writes the next_step_* we return onto the
// AIAT quiz doc, which the quiz-taking frontend reads to chain into the survey.

// Pre-created survey form quiz ids (prod). See the AIAT survey rollout.
export const AIAT_SURVEY_QUIZ_IDS = {
  // EMRSStudents, engineering (PCM)
  emrsEngineering: "6ace518b28656603a4712d4c",
  // EMRSStudents, medical (PCB)
  emrsMedical: "6ace51cde9a0a154b7f6200c",
  // broad EnableStudents report-only survey
  reportOnly: "6ace51df28656603a4712d56",
} as const;

// The auth-group name EMRS students resolve to (quiz-session-access.resolveBatchGroups).
// EMRS batch_id prefixes are unreliable, so this matches on the resolved group, not the code.
const EMRS_GROUP = "EMRSStudents";

// A test is an AIAT when its CMS test name contains "AIAT" (case-insensitive). The LMS session
// name is editable and may not keep it, so callers should pass the CMS test name, not the
// session name.
export function isAiatTestName(testName: string | null | undefined): boolean {
  return /\bAIAT\b/i.test(testName ?? "");
}

// Pick the survey quiz id for an AIAT, given the resolved program group and the stream.
// CET AIATs have an empty stream; they default to the engineering (PCM) survey.
export function surveyQuizIdForAiat(
  group: string | null | undefined,
  stream: string | null | undefined
): string {
  if (group === EMRS_GROUP) {
    return stream === "medical"
      ? AIAT_SURVEY_QUIZ_IDS.emrsMedical
      : AIAT_SURVEY_QUIZ_IDS.emrsEngineering; // engineering, cet (empty) -> PCM
  }
  return AIAT_SURVEY_QUIZ_IDS.reportOnly;
}

// Build the next_step_* fields to write onto an AIAT quiz doc so it chains into its survey
// BEFORE the scorecard. Returns null when the test is not an AIAT (no next step attached).
//
// The survey URL carries the frontend's templating:
//   - {apiKey}   the org api key the frontend already has
//   - {quizId}   this AIAT's quiz id, passed as return_to so the shared survey knows which
//                test's scorecard to send the student back to
// The survey's own next_step (set on the survey quiz doc) returns to /quiz/{return_to}.
const QUIZ_FRONTEND_BASE = "https://quiz.avantifellows.org";

export function aiatNextStep(params: {
  testName: string | null | undefined;
  group: string | null | undefined;
  stream: string | null | undefined;
}): {
  next_step_url: string;
  next_step_text: string;
  next_step_before_scores: true;
  next_step_autostart: true;
} | null {
  if (!isAiatTestName(params.testName)) return null;
  const surveyId = surveyQuizIdForAiat(params.group, params.stream);
  return {
    // Note: do NOT put autoStart in this URL. The quiz player appends autoStart=true itself
    // when next_step_autostart is set (below); a literal one here would duplicate the param,
    // and the router reads the resulting array as "not true", silently disabling auto-start.
    next_step_url:
      `${QUIZ_FRONTEND_BASE}/form/${surveyId}` +
      `?apiKey={apiKey}&singlePageMode=true&return_to={quizId}`,
    next_step_text: "Continue to survey",
    next_step_before_scores: true,
    next_step_autostart: true,
  };
}
