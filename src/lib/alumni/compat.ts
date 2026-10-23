// Which degrees go with which branch, e.g. a CS/IT branch can't be an MBBS.
// Shared by the form (filters the Degree dropdown) and validation (rejects bad pairs).
//
// Rules are keyed by branch *group*: every branch code is its group code plus
// digits (ELEC067 → ELEC, CSIT012 → CSIT; airbyte.branch, checked 2026-10-06).
// Groups are the top-level rows of airbyte.branch. The allowed degrees come
// from the pairs that actually occur in dim_alumni, minus obvious mistakes.
// A group not listed here (or "OTHER") allows every degree.

export type Level = "ug" | "pg";

const ENGG = ["BTech/BE", "BTech/MTech", "Diploma - Engg"];
const SCIENCE = ["BSc", "BSc/MSc", "BS", "BS/MS", "BSc/BEd", "Vocational Course"];
const ARTS = ["BA", "BA/BEd"];
const COMMERCE = ["BCom", "BBA"];
const MED_ALLIED = ["BSc", "Diploma - Medical", "Other - Medical"];

const PG_ENGG = ["MTech", "MS", "MSc", "PhD", "MPhil"];
const PG_SCIENCE = ["MSc", "MS", "PhD", "MPhil", "BEd"];
const PG_ARTS = ["MA", "PhD", "MPhil", "BEd"];

const ENGINEERING_GROUPS = [
  "CSIT", "AIML", "ELEC", "MECHENG", "CIVILENG", "CHEMENG", "INDENG", "MEMS", "MNC", "TEXTILE", "AERO",
  "ROBOENG", "FOODENG", "OILPAINTTECH", "INSTRENG", "BIOMEDENG", "MARINE", "MININGENG", "CHEMSCI", "ENVENG",
  "POLYMERTECH", "CERAMIC", "BIOENG", "AUTOENG", "AGRIENG", "PHARMAENG", "ENERGYENG", "ENGPHY", "PRINTENG",
  "ENGDES", "PETROLENG", "SAFETYENG", "BIOCHEMENG", "SPACEENG", "BIOSCI", "PAPERENG", "DAIRYENG", "ENGSCI",
  "EARTHSCI", "GENENG", "SYSENG", "CYBERSEC", "PLAN", "BIOTECH",
];
const SCIENCE_GROUPS = [
  "PHYSICS", "CHEM", "MATH", "BIO", "BIOCHEM", "BOT", "ZOO", "GENSCI", "NATSCI", "LIFESCI", "GEO", "FORENSIC",
  "INDCHEM", "AGRI", "HORTI", "FOREST", "FISH", "SERI", "NAUTICALSCI",
];
const ARTS_GROUPS = ["ARTS", "ENGLISH", "HIST", "POLISCI", "JOURNAL", "JAPANESE", "SOCIALWORK", "MUSIC"];

const UG: Record<string, string[]> = {
  ...Object.fromEntries(ENGINEERING_GROUPS.map((g) => [g, [...ENGG, ...SCIENCE]])),
  ...Object.fromEntries(SCIENCE_GROUPS.map((g) => [g, SCIENCE])),
  ...Object.fromEntries(ARTS_GROUPS.map((g) => [g, ARTS])),
  CSIT: [...ENGG, ...SCIENCE, "BCA", "Techbee"],
  AIML: [...ENGG, ...SCIENCE, "BCA", "BStat"],
  MNC: [...ENGG, ...SCIENCE, "BStat"],
  CYBERSEC: [...ENGG, ...SCIENCE, "BCA"],
  PLAN: [...ENGG, "BArch"],
  AGRI: [...SCIENCE, "BTech/BE"],
  BCA: ["BCA", ...SCIENCE],
  HCL: ["Techbee", "BCA", "BSc", "Vocational Course"],
  PSYCH: [...ARTS, ...SCIENCE],
  ECON: [...ARTS, ...SCIENCE, ...COMMERCE, "BStat"],
  COMMERCE: COMMERCE,
  FIN: COMMERCE,
  CA: COMMERCE,
  MBA: ["BBA"],
  LLB: ["BA LLB", "BA", "BBA"],
  TEACH: ["BA/BEd", "BSc/BEd"],
  ARCH: ["BArch"],
  DESIGN: ["BDes"],
  HOTELMGT: ["BHM", "BBA", "BSc"],
  DEFENCE: ["Other-Govt/Army/Navy", "BTech/BE", "BSc", "BA"],
  MBBS: ["MBBS"],
  DENTAL: ["BDS"],
  AYUR: ["BAMS"],
  HOMEO: ["BHMS"],
  NATURO: ["BNYS"],
  VET: ["BVSc"],
  PHARMA: ["BPharm", "DPharm", "Pharm D", "Diploma - Medical"],
  PHYSIO: ["BPT", ...MED_ALLIED],
  NURSING: MED_ALLIED,
  PARAMED: MED_ALLIED,
  LABTECH: MED_ALLIED,
  RADIOLOGY: MED_ALLIED,
  AUDI: MED_ALLIED,
  ADMIN: ["Other - Medical", "BBA", "BA"],
};

const PG: Record<string, string[]> = {
  ...Object.fromEntries(ENGINEERING_GROUPS.map((g) => [g, PG_ENGG])),
  ...Object.fromEntries(SCIENCE_GROUPS.map((g) => [g, PG_SCIENCE])),
  ...Object.fromEntries(ARTS_GROUPS.map((g) => [g, PG_ARTS])),
  CSIT: [...PG_ENGG, "MCA"],
  AIML: [...PG_ENGG, "MCA"],
  CYBERSEC: [...PG_ENGG, "MCA"],
  BCA: ["MCA", "MSc", "MTech", "PhD"],
  PSYCH: [...PG_ARTS, "MSc"],
  ECON: [...PG_ARTS, "MSc"],
  COMMERCE: ["MCom", "MBA", "PhD"],
  FIN: ["MCom", "MBA", "PhD"],
  CA: ["MCom", "MBA"],
  MBA: ["MBA", "PhD"],
  LLB: ["LLB", "MLLM", "PhD"],
  TEACH: ["BEd"],
  DESIGN: ["MDes", "PhD"],
  MBBS: ["MD", "MS (Surgery)", "PhD"],
  DENTAL: ["MDS", "PhD"],
  PHARMA: ["MPharm", "PhD"],
  NURSING: ["MSc", "PhD"],
};

/** Degrees allowed with any branch. */
const ALWAYS = ["Other"];

/** ELEC067 → ELEC. */
export function branchGroup(code: string): string {
  return code.trim().toUpperCase().replace(/\d+$/, "");
}

/** Allowed degrees for this branch, or null when there's no rule (no branch / unknown group). */
export function allowedDegrees(level: Level, branchCode: string): string[] | null {
  if (!branchCode) return null;
  const list = (level === "ug" ? UG : PG)[branchGroup(branchCode)];
  return list ? [...list, ...ALWAYS] : null;
}

export function isDegreeCompatible(level: Level, branchCode: string, degree: string): boolean {
  if (!degree) return true;
  const allowed = allowedDegrees(level, branchCode);
  return !allowed || allowed.includes(degree);
}
