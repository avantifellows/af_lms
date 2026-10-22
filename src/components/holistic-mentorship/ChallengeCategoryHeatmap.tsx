"use client";

import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Select } from "@/components/ui";
import { downloadFile } from "@/lib/file-download";
import {
  HOLISTIC_CHALLENGE_CATEGORIES,
  holisticChallengeCategoryPercent,
} from "@/lib/holistic-challenge-categories";
import {
  HEATMAP_LEGEND_GRADIENT,
  heatmapCellColours,
} from "@/lib/holistic-challenge-category-heatmap-colours";
import type {
  ChallengeCategoryCounts,
  ChallengeCategoryHeatmap as Heatmap,
} from "@/types/holistic-challenge-category-heatmap";

const GROUPS = [
  { group: "academic", label: "Academic" },
  { group: "non_academic", label: "Non-academic" },
] as const;

const LOAD_ERROR = "Unable to load Challenge Categories. Please try again.";

// A failed request (offline, blocked) gets the same message as a failed response,
// never the browser's own "Failed to fetch".
async function fetchHeatmap(search: string, signal: AbortSignal): Promise<Heatmap> {
  const response = await fetch(`/api/holistic-mentorship/challenge-categories?${search}`, { signal })
    .catch((problem: Error) => {
      throw signal.aborted ? problem : new Error(LOAD_ERROR);
    });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || LOAD_ERROR);
  return body;
}

// A scope's Phase options arrive with its default, so they never outlive it.
type PhaseSelection = { scope: string; phaseId: number | null; phases: Heatmap["phases"] };
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
    fetchHeatmap(search, controller.signal)
      .then((data) => {
        if (pendingDefault) {
          setSelection({ scope, phaseId: data.defaultPhaseId, phases: data.phases });
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
    // Until this scope's default resolves (loading, or its load failed), the
    // previous scope's Phases would be stale, so there are none to pick.
    phases: pendingDefault ? [] : selection.phases,
    phasesReady: !pendingDefault,
    search,
    selectPhase: (next: number | null) => setSelection({ scope, phaseId: next, phases: selection?.phases ?? [] }),
    reload: () => setRefresh((value) => value + 1),
  };
}

// The route names the file from the filters (year, Grade, Program, Phase).
function attachmentFilename(response: Response) {
  return /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1]
    ?? "challenge-categories.csv";
}

function useHeatmapDownload(search: string) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const download = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadFile(`/api/holistic-mentorship/challenge-categories?${search}&format=csv`,
        "Unable to download Challenge Categories", attachmentFilename);
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
      style={{ backgroundImage: HEATMAP_LEGEND_GRADIENT }} />
    <span>100%</span>
  </div>;
}

function HeatmapRow({ label, studentCount, counts, emphasised }: {
  label: string;
  studentCount: number;
  counts: ChallengeCategoryCounts;
  emphasised?: boolean;
}) {
  // Borders sit on the cells: the table's separate borders keep each sticky
  // School cell's border over its own opaque background while scrolled.
  const border = emphasised ? "border-b-2 border-border" : "border-b border-border";
  return <tr className={emphasised ? "font-bold" : undefined}>
    <th scope="row" className={`sticky left-0 z-10 min-w-36 max-w-48 bg-bg-card px-3 py-2 text-left text-xs ${border}`}>
      <span className="block break-words text-text-primary">{label}</span>
      <span className="block font-mono font-normal text-text-muted">n = {studentCount}</span>
    </th>
    {HOLISTIC_CHALLENGE_CATEGORIES.map(({ code }) => {
      const percent = holisticChallengeCategoryPercent(counts[code] ?? 0, studentCount);
      return <td key={code} style={heatmapCellColours(percent)}
        className={`px-2 py-2 text-center font-mono text-xs tabular-nums ${border}`}>
        {percent.toFixed(1)}%
      </td>;
    })}
  </tr>;
}

function HeatmapGrid({ data }: { data: Heatmap }) {
  return <div className="max-w-full overflow-x-auto rounded-md border border-border">
    <table aria-label="Challenge Category Heatmap"
      className="min-w-full border-separate border-spacing-0 bg-bg-card text-sm">
      <thead>
        <tr>
          <th scope="col" rowSpan={2}
            className="sticky left-0 z-20 border-b border-border bg-bg-card px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            School
          </th>
          {GROUPS.map(({ group, label }) => <th key={group} scope="colgroup"
            colSpan={HOLISTIC_CHALLENGE_CATEGORIES.filter((category) => category.group === group).length}
            className="border-b border-l border-border px-2 py-2 text-center text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            {label}
          </th>)}
        </tr>
        <tr>
          {HOLISTIC_CHALLENGE_CATEGORIES.map((category) => {
            const groupLabel = GROUPS.find(({ group }) => group === category.group)!.label;
            return <th key={category.code} scope="col" title={category.label}
              aria-label={`${groupLabel}: ${category.label}`}
              className="min-w-16 border-b border-border px-2 py-2 text-center align-bottom text-[11px] font-bold text-text-secondary">
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

function HeatmapHeader({ canDownload, downloading, onDownload }: {
  canDownload: boolean;
  downloading: boolean;
  onDownload: () => void;
}) {
  return <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="space-y-1">
      <h2 id="challenge-category-heatmap-title" className="text-lg font-bold text-text-primary">
        Challenge Categories
      </h2>
      <p className="text-sm text-text-secondary">
        Share of Students with categorized submitted Post-Session Notes who carry each Challenge Category.
      </p>
    </div>
    {canDownload && <Button type="button" onClick={onDownload} disabled={downloading}>
      <Download aria-hidden="true" className="h-4 w-4" /> {downloading ? "Downloading..." : "Download CSV"}
    </Button>}
  </div>;
}

function HeatmapLoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (!error) return null;
  return <div className="flex flex-wrap items-center gap-3">
    <p role="alert" className="text-sm text-danger">{error}</p>
    <Button type="button" variant="secondary" className="text-xs" onClick={onRetry}>Retry</Button>
  </div>;
}

function HeatmapResult({ data }: { data: Heatmap }) {
  return <>
    {data.total.studentCount === 0
      ? <p className="rounded-md border border-border bg-bg-card px-4 py-8 text-center text-sm text-text-muted">
          No submitted Post-Session Notes with Challenge Categories match this selection yet.
        </p>
      : <>
          <Legend />
          <HeatmapGrid data={data} />
        </>}
    {data.hiddenSchoolCount > 0 && <p className="text-xs text-text-muted">
      {hiddenSchoolsNote(data.hiddenSchoolCount)}
    </p>}
  </>;
}

// `programId="all"`: every Program the viewer can see, with Phase locked to All Phases.
export default function ChallengeCategoryHeatmap({ programId, academicYear, onAcademicYears }: {
  programId: number | "all";
  academicYear: string;
  onAcademicYears?: (years: string[]) => void;
}) {
  const [grade, setGrade] = useState<11 | 12>(11);
  const { data, error, loading, phaseId, phases, phasesReady, search, selectPhase, reload } =
    useHeatmap(programId, academicYear, grade);
  const { downloading, downloadError, download } = useHeatmapDownload(search);
  const academicYears = data?.academicYears;
  const allPrograms = programId === "all";

  useEffect(() => {
    if (academicYears?.length) onAcademicYears?.(academicYears);
  }, [academicYears, onAcademicYears]);

  return <section aria-busy={loading} aria-labelledby="challenge-category-heatmap-title"
    className="w-full min-w-0 max-w-full space-y-4">
    <HeatmapHeader canDownload={Boolean(data && data.total.studentCount > 0)} downloading={downloading}
      onDownload={() => void download()} />
    {downloadError && <p role="alert" className="text-sm text-danger">{downloadError}</p>}
    <HeatmapFilters grade={grade} phaseId={phaseId} phases={allPrograms ? [] : phases}
      disabled={loading || allPrograms || !phasesReady}
      onGradeChange={setGrade} onPhaseChange={selectPhase} />
    {loading && <p role="status" className="py-8 text-center text-sm text-text-muted">
      Loading Challenge Categories...
    </p>}
    <HeatmapLoadError error={error} onRetry={reload} />
    {data && <HeatmapResult data={data} />}
  </section>;
}
