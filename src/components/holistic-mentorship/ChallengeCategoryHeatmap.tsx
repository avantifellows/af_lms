"use client";

import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Select } from "@/components/ui";
import {
  HOLISTIC_CHALLENGE_CATEGORIES,
  holisticChallengeCategoryPercent,
} from "@/lib/holistic-challenge-categories";
import type {
  ChallengeCategoryCounts,
  ChallengeCategoryHeatmap as Heatmap,
} from "@/types/holistic-challenge-category-heatmap";

const GROUPS = [
  { group: "academic", label: "Academic" },
  { group: "non_academic", label: "Non-academic" },
] as const;

// Linear 0-100 scale: light yellow -> dark red.
const LOW = [255, 247, 188];
const HIGH = [153, 0, 13];

function channel(value: number) {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function cellColours(percent: number) {
  const rgb = LOW.map((low, index) => Math.round(low + (HIGH[index] - low) * (percent / 100)));
  const luminance = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  // Pick whichever text colour has the higher contrast ratio on this cell.
  const whiteText = 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05;
  return { backgroundColor: `rgb(${rgb.join(", ")})`, color: whiteText ? "#ffffff" : "#1f2937" };
}

async function readHeatmapResponse(response: Response): Promise<Heatmap> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw new Error(body?.error || "Unable to load Challenge Categories. Please try again.");
  }
  return body;
}

type PhaseSelection = { scope: string; phaseId: number | null };
type Loaded = { key: string; data: Heatmap | null; error: string };

// Changing Program, year or Grade (the scope) resets Phase to the new default:
// the first request for a scope is All Phases, whose response names the default.
function useHeatmap(programId: number | "all", academicYear: string, grade: 11 | 12) {
  const scope = `${programId}|${academicYear}|${grade}`;
  const [selection, setSelection] = useState<PhaseSelection | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ key: "", data: null, error: "" });
  const loadedKey = useRef("");
  const pendingDefault = selection?.scope !== scope;
  const phaseId = pendingDefault ? null : selection.phaseId;
  const params = new URLSearchParams({
    program_id: String(programId), academic_year: academicYear, grade: String(grade),
  });
  if (phaseId !== null) params.set("phase_id", String(phaseId));
  const search = params.toString();
  const key = `${search}#${refresh}`;

  useEffect(() => {
    // A default that resolved to All Phases already loaded this exact request.
    if (!pendingDefault && loadedKey.current === key) return;
    const controller = new AbortController();
    fetch(`/api/holistic-mentorship/challenge-categories?${search}`, { signal: controller.signal })
      .then(readHeatmapResponse)
      .then((data) => {
        if (pendingDefault) {
          setSelection({ scope, phaseId: data.defaultPhaseId });
          if (data.defaultPhaseId !== null) return;
        }
        loadedKey.current = key;
        setLoaded({ key, data, error: "" });
      })
      .catch((problem: Error) => {
        if (controller.signal.aborted || problem.name === "AbortError") return;
        loadedKey.current = key;
        setLoaded({ key, data: null, error: problem.message });
      });
    return () => controller.abort();
  }, [key, pendingDefault, scope, search]);

  // An error can end the default-resolving request too; Retry then resolves it again.
  const error = loaded.key === key ? loaded.error : "";
  const current = !pendingDefault && loaded.key === key;
  return {
    data: current ? loaded.data : null,
    error,
    loading: !current && !error,
    phaseId,
    search,
    selectPhase: (next: number | null) => setSelection({ scope, phaseId: next }),
    reload: () => setRefresh((value) => value + 1),
  };
}

// The route names the file from the filters (year, Grade, Program, Phase).
function useHeatmapDownload(search: string) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const download = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(`/api/holistic-mentorship/challenge-categories?${search}&format=csv`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Unable to download Challenge Categories (${response.status})`);
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1];
      const downloadUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = filename ?? "challenge-categories.csv";
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (problem) {
      setDownloadError(problem instanceof Error ? problem.message : "Unable to download Challenge Categories");
    } finally {
      setDownloading(false);
    }
  };
  return { downloading, downloadError, download };
}

function HeatmapFilters({ grade, phaseId, phases, disabled, onGradeChange, onPhaseChange }: {
  grade: 11 | 12;
  phaseId: number | null;
  phases: Heatmap["phases"];
  disabled: boolean;
  onGradeChange: (grade: 11 | 12) => void;
  onPhaseChange: (phaseId: number | null) => void;
}) {
  const labelClass = "block min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-text-muted";
  return <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,20rem)]">
    <label className={labelClass}>
      Grade
      <Select aria-label="Grade" className="mt-1 font-normal normal-case tracking-normal" value={grade}
        onChange={(event) => onGradeChange(Number(event.target.value) as 11 | 12)}>
        <option value={11}>Grade 11</option>
        <option value={12}>Grade 12</option>
      </Select>
    </label>
    <label className={labelClass}>
      Phase
      <Select aria-label="Phase" className="mt-1 font-normal normal-case tracking-normal" disabled={disabled}
        value={phaseId ?? ""}
        onChange={(event) => onPhaseChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">All Phases</option>
        {phases.map((phase) => <option key={phase.id} value={phase.id}>
          Phase {phase.number} - {phase.title}
        </option>)}
      </Select>
    </label>
  </div>;
}

function Legend() {
  return <div className="flex items-center gap-2 text-xs text-text-muted" aria-label="Colour scale from 0% to 100%">
    <span>0%</span>
    <span aria-hidden="true" className="h-3 w-32 rounded-sm"
      style={{ backgroundImage: `linear-gradient(to right, rgb(${LOW.join(", ")}), rgb(${HIGH.join(", ")}))` }} />
    <span>100%</span>
  </div>;
}

function HeatmapRow({ label, studentCount, counts, emphasised }: {
  label: string;
  studentCount: number;
  counts: ChallengeCategoryCounts;
  emphasised?: boolean;
}) {
  return <tr className={emphasised ? "border-b-2 border-border font-bold" : "border-b border-border"}>
    <th scope="row" className="sticky left-0 z-10 min-w-36 max-w-48 bg-bg-card px-3 py-2 text-left text-xs">
      <span className="block break-words text-text-primary">{label}</span>
      <span className="block font-mono font-normal text-text-muted">n = {studentCount}</span>
    </th>
    {HOLISTIC_CHALLENGE_CATEGORIES.map(({ code }) => {
      const percent = holisticChallengeCategoryPercent(counts[code] ?? 0, studentCount);
      return <td key={code} style={cellColours(percent)}
        className="px-2 py-2 text-center font-mono text-xs tabular-nums">
        {percent.toFixed(1)}%
      </td>;
    })}
  </tr>;
}

function HeatmapGrid({ data }: { data: Heatmap }) {
  return <div className="max-w-full overflow-x-auto rounded-md border border-border">
    <table aria-label="Challenge Category Heatmap" className="min-w-full border-collapse bg-bg-card text-sm">
      <thead>
        <tr className="border-b border-border">
          <th scope="col" rowSpan={2}
            className="sticky left-0 z-20 bg-bg-card px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            School
          </th>
          {GROUPS.map(({ group, label }) => <th key={group} scope="colgroup"
            colSpan={HOLISTIC_CHALLENGE_CATEGORIES.filter((category) => category.group === group).length}
            className="border-l border-border px-2 py-2 text-center text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            {label}
          </th>)}
        </tr>
        <tr className="border-b border-border">
          {HOLISTIC_CHALLENGE_CATEGORIES.map((category) => {
            const groupLabel = GROUPS.find(({ group }) => group === category.group)!.label;
            return <th key={category.code} scope="col" title={category.label}
              aria-label={`${groupLabel}: ${category.label}`}
              className="min-w-16 px-2 py-2 text-center align-bottom text-[11px] font-bold text-text-secondary">
              <span aria-hidden="true" className="sm:hidden">{category.shortLabel}</span>
              <span aria-hidden="true" className="hidden sm:inline">{category.label}</span>
            </th>;
          })}
        </tr>
      </thead>
      <tbody>
        <HeatmapRow label="All Schools" studentCount={data.total.studentCount} counts={data.total.counts} emphasised />
        {data.schools.map((school) => <HeatmapRow key={school.code} label={school.name}
          studentCount={school.studentCount} counts={school.counts} />)}
      </tbody>
    </table>
  </div>;
}

function hiddenSchoolsNote(count: number) {
  return count === 1
    ? "1 School has no categorized Notes yet"
    : `${count} Schools have no categorized Notes yet`;
}

// `programId="all"`: every Program the viewer can see, with Phase locked to All Phases.
export default function ChallengeCategoryHeatmap({ programId, academicYear, onAcademicYears }: {
  programId: number | "all";
  academicYear: string;
  onAcademicYears?: (years: string[]) => void;
}) {
  const [grade, setGrade] = useState<11 | 12>(11);
  const { data, error, loading, phaseId, search, selectPhase, reload } = useHeatmap(programId, academicYear, grade);
  const { downloading, downloadError, download } = useHeatmapDownload(search);
  const [phases, setPhases] = useState<Heatmap["phases"]>([]);
  const academicYears = data?.academicYears;
  const allPrograms = programId === "all";

  useEffect(() => {
    if (academicYears?.length) onAcademicYears?.(academicYears);
  }, [academicYears, onAcademicYears]);

  // Keep the Phase options from the last response for this scope while the next loads.
  if (data && data.phases !== phases) setPhases(data.phases);

  return <section aria-busy={loading} aria-labelledby="challenge-category-heatmap-title"
    className="w-full min-w-0 max-w-full space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 id="challenge-category-heatmap-title" className="text-lg font-bold text-text-primary">
          Challenge Categories
        </h2>
        <p className="text-sm text-text-secondary">
          Share of Students with categorized submitted Post-Session Notes who carry each Challenge Category.
        </p>
      </div>
      {data && data.total.studentCount > 0 && <Button type="button" onClick={() => void download()}
        disabled={downloading}>
        <Download aria-hidden="true" className="h-4 w-4" /> {downloading ? "Downloading..." : "Download CSV"}
      </Button>}
    </div>
    {downloadError && <p role="alert" className="text-sm text-danger">{downloadError}</p>}
    <HeatmapFilters grade={grade} phaseId={phaseId} phases={allPrograms ? [] : phases}
      disabled={loading || allPrograms}
      onGradeChange={setGrade} onPhaseChange={selectPhase} />
    {loading && <p role="status" className="py-8 text-center text-sm text-text-muted">
      Loading Challenge Categories...
    </p>}
    {error && <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-danger">{error}</p>
      <Button type="button" variant="secondary" className="text-xs" onClick={reload}>Retry</Button>
    </div>}
    {data && data.total.studentCount === 0 && <p className="rounded-md border border-border bg-bg-card px-4 py-8 text-center text-sm text-text-muted">
      No submitted Post-Session Notes with Challenge Categories match this selection yet.
    </p>}
    {data && data.total.studentCount > 0 && <>
      <Legend />
      <HeatmapGrid data={data} />
    </>}
    {data && data.hiddenSchoolCount > 0 && <p className="text-xs text-text-muted">
      {hiddenSchoolsNote(data.hiddenSchoolCount)}
    </p>}
  </section>;
}
