export interface ResourceNameEntry {
  resource?: string;
  lang_code?: string;
}

export interface QuizTemplateTypeParams {
  grade?: number | string;
  course?: string;
  stream?: string;
  test_format?: string;
  test_purpose?: string;
  test_type?: string;
  optional_limits?: string;
  cms_link?: string;
  src_link?: string;
  cms_test_id?: string;
  question_pdf?: string;
  solution_pdf?: string;
  ranking_cutoff_date?: string;
  is_active?: boolean;
  test_code?: string;
  test_name?: string;
  sheet_name?: string;
}

export interface RawQuizTemplateResource {
  id: number;
  code?: string | null;
  type?: string | null;
  subtype?: string | null;
  source?: string | null;
  name?: ResourceNameEntry[] | string | null;
  type_params?: QuizTemplateTypeParams | string | null;
}

export interface QuizTemplateResource {
  id: number;
  code: string;
  name: string;
  type: string;
  subtype: string;
  source: string;
  grade: number | null;
  course: string;
  stream: string;
  testFormat: string;
  testPurpose: string;
  testType: string;
  optionalLimits: string;
  cmsLink: string;
  cmsSourceId: string;
  questionPdf: string;
  solutionPdf: string;
  rankingCutoffDate: string;
  isActive: boolean;
  sheetName: string;
}

function parseJsonIfNeeded<T>(value: T | string | null | undefined): T | null {
  if (value == null) return null;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getResourceDisplayName(
  name: ResourceNameEntry[] | string | null | undefined
): string {
  const parsed = parseJsonIfNeeded<ResourceNameEntry[]>(name);
  if (Array.isArray(parsed)) {
    const english = parsed.find((entry) => entry?.lang_code === "en" && entry?.resource);
    if (english?.resource) return english.resource;

    const first = parsed.find((entry) => entry?.resource);
    if (first?.resource) return first.resource;
  }

  if (typeof name === "string") return name;
  return "";
}

export function extractCmsSourceId(cmsLink: string, fallback = ""): string {
  if (!cmsLink) return fallback;

  try {
    const url = new URL(cmsLink);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || fallback;
  } catch {
    return fallback;
  }
}

export function parseQuizTemplateResource(
  resource: RawQuizTemplateResource
): QuizTemplateResource {
  const typeParams =
    parseJsonIfNeeded<QuizTemplateTypeParams>(resource.type_params) ?? {};
  const cmsLink = `${typeParams.cms_link || typeParams.src_link || ""}`.trim();
  const code = `${resource.code || typeParams.test_code || ""}`.trim();
  const name =
    getResourceDisplayName(resource.name) ||
    `${typeParams.test_name || code || `Template ${resource.id}`}`.trim();

  const rawGrade = typeParams.grade;
  const parsedGrade =
    rawGrade === undefined || rawGrade === null || rawGrade === ""
      ? null
      : Number(rawGrade);

  return {
    id: resource.id,
    code,
    name,
    type: `${resource.type || ""}`.trim(),
    subtype: `${resource.subtype || ""}`.trim(),
    source: `${resource.source || ""}`.trim(),
    grade: Number.isNaN(parsedGrade) ? null : parsedGrade,
    course: `${typeParams.course || ""}`.trim(),
    stream: `${typeParams.stream || ""}`.trim(),
    testFormat: `${typeParams.test_format || ""}`.trim(),
    testPurpose: `${typeParams.test_purpose || ""}`.trim(),
    testType: `${typeParams.test_type || ""}`.trim(),
    optionalLimits: `${typeParams.optional_limits || ""}`.trim(),
    cmsLink,
    cmsSourceId: `${typeParams.cms_test_id || ""}`.trim() || extractCmsSourceId(cmsLink),
    questionPdf: `${typeParams.question_pdf || ""}`.trim(),
    solutionPdf: `${typeParams.solution_pdf || ""}`.trim(),
    rankingCutoffDate: `${typeParams.ranking_cutoff_date || ""}`.trim(),
    isActive: typeParams.is_active !== false,
    sheetName: `${typeParams.sheet_name || ""}`.trim(),
  };
}
