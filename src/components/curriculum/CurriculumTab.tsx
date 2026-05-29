"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Chapter,
  ChapterProgress,
  CurriculumGradeSubjectOption,
  CurriculumOptionsResponse,
  ExamTrack,
  GradeNumber,
  SubjectName,
} from "@/types/curriculum";
import ChapterAccordion from "./ChapterAccordion";

interface CurriculumTabProps {
  schoolCode: string;
  schoolName: string;
  canEdit: boolean;
}

function examTrackLabel(track: ExamTrack | null): string {
  switch (track) {
    case "jee_main":
      return "JEE Main";
    case "jee_advanced":
      return "JEE Advanced";
    case "neet":
      return "NEET";
    default:
      return "Curriculum";
  }
}

function selectFirstGradeSubject(
  gradeSubjects: CurriculumGradeSubjectOption[],
  examTrack: ExamTrack | null,
  grade?: GradeNumber | null
) {
  return gradeSubjects.find(
    (option) =>
      option.examTrack === examTrack && (grade == null || option.grade === grade)
  ) ?? null;
}

export default function CurriculumTab({
  schoolCode,
  schoolName,
  canEdit,
}: CurriculumTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [options, setOptions] = useState<CurriculumOptionsResponse | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [selectedExamTrack, setSelectedExamTrack] = useState<ExamTrack | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<GradeNumber | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<SubjectName | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [progress] = useState<Record<number, ChapterProgress>>({});
  const [isOptionsLoading, setIsOptionsLoading] = useState(true);
  const [isChaptersLoading, setIsChaptersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChapterIds, setExpandedChapterIds] = useState<number[]>([]);
  const [activeTab, setActiveTabState] = useState<"chapters" | "logs">(
    searchParams.get("curriculum") === "logs" ||
      searchParams.get("curriculum") === "history"
      ? "logs"
      : "chapters"
  );

  useEffect(() => {
    let isCancelled = false;

    async function fetchOptions() {
      setIsOptionsLoading(true);
      setError(null);
      setChapters([]);

      try {
        const response = await fetch(
          `/api/curriculum/options?school_code=${encodeURIComponent(schoolCode)}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch Curriculum options");
        }

        const data = (await response.json()) as CurriculumOptionsResponse;
        if (isCancelled) return;

        setOptions(data);
        setSelectedProgramId(data.defaults.programId);
        setSelectedExamTrack(data.defaults.examTrack);
        setSelectedGrade(data.defaults.grade);
        setSelectedSubject(data.defaults.subject);
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!isCancelled) {
          setIsOptionsLoading(false);
        }
      }
    }

    fetchOptions();
    return () => {
      isCancelled = true;
    };
  }, [schoolCode]);

  useEffect(() => {
    if (!selectedProgramId || !selectedExamTrack || !selectedGrade || !selectedSubject) {
      setChapters([]);
      return;
    }

    let isCancelled = false;

    async function fetchChapters() {
      setIsChaptersLoading(true);
      setError(null);

      const params = new URLSearchParams({
        school_code: schoolCode,
        program_id: String(selectedProgramId),
        exam_track: selectedExamTrack,
        grade: String(selectedGrade),
        subject: selectedSubject,
      });

      try {
        const response = await fetch(`/api/curriculum/chapters?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch chapters");
        }
        const data = (await response.json()) as { chapters: Chapter[] };
        if (!isCancelled) {
          setChapters(data.chapters);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!isCancelled) {
          setIsChaptersLoading(false);
        }
      }
    }

    fetchChapters();
    return () => {
      isCancelled = true;
    };
  }, [schoolCode, selectedProgramId, selectedExamTrack, selectedGrade, selectedSubject]);

  const gradeOptions = useMemo(() => {
    if (!options || !selectedExamTrack) return [];
    return Array.from(
      new Map(
        options.gradeSubjects
          .filter((option) => option.examTrack === selectedExamTrack)
          .map((option) => [option.grade, option])
      ).values()
    );
  }, [options, selectedExamTrack]);

  const subjectOptions = useMemo(() => {
    if (!options || !selectedExamTrack || !selectedGrade) return [];
    return options.gradeSubjects.filter(
      (option) =>
        option.examTrack === selectedExamTrack && option.grade === selectedGrade
    );
  }, [options, selectedExamTrack, selectedGrade]);

  const setActiveTab = (tab: "chapters" | "logs") => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "chapters") params.delete("curriculum");
    else params.set("curriculum", "logs");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  const toggleChapter = useCallback((chapterId: number) => {
    setExpandedChapterIds((prev) =>
      prev.includes(chapterId)
        ? prev.filter((id) => id !== chapterId)
        : [...prev, chapterId]
    );
  }, []);

  function handleExamTrackChange(track: ExamTrack) {
    const first = selectFirstGradeSubject(options?.gradeSubjects ?? [], track);
    setSelectedExamTrack(track);
    setSelectedGrade(first?.grade ?? null);
    setSelectedSubject(first?.subject ?? null);
  }

  function handleGradeChange(grade: GradeNumber) {
    const first = selectFirstGradeSubject(
      options?.gradeSubjects ?? [],
      selectedExamTrack,
      grade
    );
    setSelectedGrade(grade);
    setSelectedSubject(first?.subject ?? null);
  }

  const hasEmptyConfig =
    !isOptionsLoading &&
    options != null &&
    options.programs.length > 0 &&
    options.examTracks.length === 0;
  const hasNoPrograms =
    !isOptionsLoading && options != null && options.programs.length === 0;

  return (
    <div>
      <div className="mb-4 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {examTrackLabel(selectedExamTrack)} Curriculum Progress
            </h2>
            <p className="text-sm text-gray-500">{schoolName}</p>
          </div>
          {!canEdit && (
            <span className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded">
              View Only
            </span>
          )}
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          {options && options.programs.length > 1 && (
            <div>
              <label
                htmlFor="curriculum-program"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Program
              </label>
              <select
                id="curriculum-program"
                value={selectedProgramId ?? ""}
                onChange={(event) => setSelectedProgramId(Number(event.target.value))}
                className="block w-36 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:ring-1 focus:ring-accent/20"
              >
                {options.programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor="exam-track"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Exam Track
            </label>
            <select
              id="exam-track"
              value={selectedExamTrack ?? ""}
              disabled={!options || options.examTracks.length === 0}
              onChange={(event) => handleExamTrackChange(event.target.value as ExamTrack)}
              className="block w-40 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:bg-gray-100 disabled:text-gray-500"
            >
              {options?.examTracks.map((track) => (
                <option key={track} value={track}>
                  {examTrackLabel(track)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="grade"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Grade
            </label>
            <select
              id="grade"
              value={selectedGrade ?? ""}
              disabled={gradeOptions.length === 0}
              onChange={(event) =>
                handleGradeChange(Number(event.target.value) as GradeNumber)
              }
              className="block w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:bg-gray-100 disabled:text-gray-500"
            >
              {gradeOptions.map((option) => (
                <option key={option.grade} value={option.grade}>
                  {option.grade}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="subject"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Subject
            </label>
            <select
              id="subject"
              value={selectedSubject ?? ""}
              disabled={subjectOptions.length === 0}
              onChange={(event) => setSelectedSubject(event.target.value as SubjectName)}
              className="block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:bg-gray-100 disabled:text-gray-500"
            >
              {subjectOptions.map((option) => (
                <option key={option.subject} value={option.subject}>
                  {option.subject}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          {canEdit && (
            <button
              disabled
              className="px-4 py-2 bg-gray-200 text-gray-500 text-sm font-medium rounded-md cursor-not-allowed"
            >
              + Add Log
            </button>
          )}
        </div>
      </div>

      {isOptionsLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-accent" />
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      ) : hasNoPrograms ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No curriculum-enabled Programs are available for this school.
        </div>
      ) : hasEmptyConfig ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No Curriculum configuration is available for this school.
        </div>
      ) : (
        <>
          <div className="bg-amber-50 text-amber-800 p-3 rounded-lg mb-4 text-sm">
            Backend Progress and Logs are not available yet for this scope.
          </div>

          <div className="border-b border-gray-200 mb-4">
            <nav className="flex space-x-8">
              <button
                onClick={() => setActiveTab("chapters")}
                className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === "chapters"
                    ? "border-accent text-accent"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Chapters
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === "logs"
                    ? "border-accent text-accent"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Logs
              </button>
            </nav>
          </div>

          {isChaptersLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-accent" />
            </div>
          ) : activeTab === "chapters" ? (
            <ChapterAccordion
              chapters={chapters}
              progress={progress}
              expandedChapterIds={expandedChapterIds}
              onToggleChapter={toggleChapter}
            />
          ) : (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              Backend Logs are not available yet.
            </div>
          )}
        </>
      )}
    </div>
  );
}
