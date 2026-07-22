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
  LmsCurriculumLog,
  SubjectName,
} from "@/types/curriculum";
import ChapterAccordion from "./ChapterAccordion";
import LogSessionModal from "./LogSessionModal";
import ProgressSummary from "./ProgressSummary";
import SessionHistory from "./SessionHistory";
import { calculateStats } from "@/lib/curriculum-helpers";

interface CurriculumTabProps {
  schoolCode: string;
  schoolName: string;
  canEdit: boolean;
  // When set (centre pages), locks curriculum to this program and hides the
  // program selector. Falls back to the school default if the program isn't
  // available for this school.
  programId?: number;
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
  programId,
}: CurriculumTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [options, setOptions] = useState<CurriculumOptionsResponse | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [selectedExamTrack, setSelectedExamTrack] = useState<ExamTrack | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<GradeNumber | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<SubjectName | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [progress, setProgress] = useState<Record<number, ChapterProgress>>({});
  const [subjectTotalTimeMinutes, setSubjectTotalTimeMinutes] = useState(0);
  const [logs, setLogs] = useState<LmsCurriculumLog[]>([]);
  const [isOptionsLoading, setIsOptionsLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isLogSessionModalOpen, setIsLogSessionModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<LmsCurriculumLog | null>(null);
  const [isSavingLog, setIsSavingLog] = useState(false);
  const [updatingCompletionChapterId, setUpdatingCompletionChapterId] = useState<number | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedChapterIds, setExpandedChapterIds] = useState<number[]>([]);
  const [activeTab, setActiveTabState] = useState<"chapters" | "logs">(
    searchParams.get("curriculum") === "logs" ||
      searchParams.get("curriculum") === "history"
      ? "logs"
      : "chapters"
  );

  const resetScopeInteractionState = useCallback(() => {
    setLogError(null);
    setCompletionError(null);
    setEditingLog(null);
    setIsLogSessionModalOpen(false);
    setExpandedChapterIds([]);
    setIsDataLoading(true);
    setChapters([]);
    setLogs([]);
    setProgress({});
    setSubjectTotalTimeMinutes(0);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function fetchOptions() {
      setIsOptionsLoading(true);
      setError(null);
      setChapters([]);
      setLogs([]);
      setProgress({});
      setSubjectTotalTimeMinutes(0);

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
        // Centre pages stay locked to their own program even when it has no
        // curriculum options here (empty state) — never silently fall back to
        // another program's curriculum on a centre-scoped page.
        setSelectedProgramId(programId ?? data.defaults.programId);
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
  }, [schoolCode, programId]);

  useEffect(() => {
    if (!selectedProgramId || !selectedExamTrack || !selectedGrade || !selectedSubject) {
      setChapters([]);
      setLogs([]);
      setProgress({});
      setSubjectTotalTimeMinutes(0);
      setIsDataLoading(false);
      return;
    }

    const programId = selectedProgramId;
    const examTrack = selectedExamTrack;
    const grade = selectedGrade;
    const subject = selectedSubject;
    let isCancelled = false;

    async function fetchCurriculumData() {
      setIsDataLoading(true);
      setError(null);
      setLogError(null);
      setCompletionError(null);
      setChapters([]);
      setLogs([]);
      setProgress({});
      setSubjectTotalTimeMinutes(0);

      const params = new URLSearchParams({
        school_code: schoolCode,
        program_id: String(programId),
        exam_track: examTrack,
        grade: String(grade),
        subject,
      });

      try {
        const [chaptersResponse, logsResponse, progressResponse] = await Promise.all([
          fetch(`/api/curriculum/chapters?${params.toString()}`),
          fetch(`/api/curriculum/logs?${params.toString()}`),
          fetch(`/api/curriculum/progress?${params.toString()}`),
        ]);
        if (!chaptersResponse.ok || !logsResponse.ok || !progressResponse.ok) {
          throw new Error("Failed to fetch chapters");
        }
        const chaptersData = (await chaptersResponse.json()) as { chapters: Chapter[] };
        const logsData = (await logsResponse.json()) as { logs: LmsCurriculumLog[] };
        const progressData = (await progressResponse.json()) as {
          subjectTotalTimeMinutes: number;
          progress: Record<number, ChapterProgress>;
        };
        if (!isCancelled) {
          setChapters(chaptersData.chapters);
          setLogs(logsData.logs);
          setProgress(progressData.progress);
          setSubjectTotalTimeMinutes(progressData.subjectTotalTimeMinutes);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!isCancelled) {
          setIsDataLoading(false);
        }
      }
    }

    fetchCurriculumData();
    return () => {
      isCancelled = true;
    };
  }, [schoolCode, selectedProgramId, selectedExamTrack, selectedGrade, selectedSubject]);

  const refetchLogsAndProgress = useCallback(async () => {
    if (!selectedProgramId || !selectedExamTrack || !selectedGrade || !selectedSubject) {
      return;
    }

    const programId = selectedProgramId;
    const examTrack = selectedExamTrack;
    const grade = selectedGrade;
    const subject = selectedSubject;
    const params = new URLSearchParams({
      school_code: schoolCode,
      program_id: String(programId),
      exam_track: examTrack,
      grade: String(grade),
      subject,
    });

    const [logsResponse, progressResponse] = await Promise.all([
      fetch(`/api/curriculum/logs?${params.toString()}`),
      fetch(`/api/curriculum/progress?${params.toString()}`),
    ]);
    if (!logsResponse.ok || !progressResponse.ok) {
      throw new Error("Failed to refresh Curriculum Progress");
    }
    const logsData = (await logsResponse.json()) as { logs: LmsCurriculumLog[] };
    const progressData = (await progressResponse.json()) as {
      subjectTotalTimeMinutes: number;
      progress: Record<number, ChapterProgress>;
    };
    setLogs(logsData.logs);
    setProgress(progressData.progress);
    setSubjectTotalTimeMinutes(progressData.subjectTotalTimeMinutes);
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
    resetScopeInteractionState();
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
    resetScopeInteractionState();
    setSelectedGrade(grade);
    setSelectedSubject(first?.subject ?? null);
  }

  async function handleSaveLog(payload: {
    date: string;
    durationMinutes: number;
    topicIds: number[];
    completeChapterIds: number[];
    uncompleteChapterIds: number[];
  }) {
    if (!selectedProgramId || !selectedExamTrack || !selectedGrade || !selectedSubject) {
      return;
    }

    setIsSavingLog(true);
    setLogError(null);
    try {
      const isEditMode = editingLog != null;
      const response = await fetch(
        isEditMode ? `/api/curriculum/logs/${editingLog.id}` : "/api/curriculum/logs",
        {
          method: isEditMode ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEditMode
              ? {
                  log_date: payload.date,
                  duration_minutes: payload.durationMinutes,
                  topic_ids: payload.topicIds,
                }
              : {
                  school_code: schoolCode,
                  program_id: selectedProgramId,
                  exam_track: selectedExamTrack,
                  grade: selectedGrade,
                  subject: selectedSubject,
                  ...(payload.topicIds.length > 0
                    ? {
                        log_date: payload.date,
                        duration_minutes: payload.durationMinutes,
                      }
                    : {}),
                  topic_ids: payload.topicIds,
                  complete_chapter_ids: payload.completeChapterIds,
                  uncomplete_chapter_ids: payload.uncompleteChapterIds,
                }
          ),
        }
      );

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Your permissions changed. Reload the page before trying again.");
        }
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to save LMS Curriculum Log");
      }

      setIsLogSessionModalOpen(false);
      setEditingLog(null);
      try {
        await refetchLogsAndProgress();
      } catch {
        setLogError(
          "Saved, but failed to refresh Curriculum Progress. Reload the page to see the latest data."
        );
      }
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Failed to save LMS Curriculum Log");
    } finally {
      setIsSavingLog(false);
    }
  }

  async function handleToggleChapterCompletion(chapterId: number, completed: boolean) {
    if (!selectedProgramId || !selectedExamTrack || !selectedGrade || !selectedSubject) {
      return;
    }

    setUpdatingCompletionChapterId(chapterId);
    setCompletionError(null);
    try {
      const response = await fetch(`/api/curriculum/chapters/${chapterId}/completion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          program_id: selectedProgramId,
          exam_track: selectedExamTrack,
          grade: selectedGrade,
          subject: selectedSubject,
          completed,
        }),
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Your permissions changed. Reload the page before trying again.");
        }
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to update Chapter Completion");
      }

      try {
        await refetchLogsAndProgress();
      } catch {
        setCompletionError(
          "Chapter Completion was updated, but refresh failed. Reload the page to see the latest data."
        );
      }
    } catch (err) {
      setCompletionError(
        err instanceof Error ? err.message : "Failed to update Chapter Completion"
      );
    } finally {
      setUpdatingCompletionChapterId(null);
    }
  }

  async function handleDeleteLog(log: LmsCurriculumLog) {
    setLogError(null);
    try {
      const response = await fetch(`/api/curriculum/logs/${log.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Your permissions changed. Reload the page before trying again.");
        }
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to delete LMS Curriculum Log");
      }

    } catch (err) {
      setLogError(
        err instanceof Error ? err.message : "Failed to delete LMS Curriculum Log"
      );
      return;
    }

    try {
      await refetchLogsAndProgress();
    } catch {
      setLogError(
        "Deleted LMS Curriculum Log, but failed to refresh Curriculum Progress. Reload the page to see the latest data."
      );
    }
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

      <div className="mb-6">
        <div className="flex flex-wrap gap-4 items-start">
          {!programId && options && options.programs.length > 1 && (
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
                onChange={(event) => {
                  resetScopeInteractionState();
                  setSelectedProgramId(Number(event.target.value));
                }}
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
              onChange={(event) => {
                resetScopeInteractionState();
                setSelectedSubject(event.target.value as SubjectName);
              }}
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
            <div className="flex flex-col items-end">
              {/* invisible spacer matching the filter labels so the button lines
                  up with the select boxes, not the labels above them */}
              <span aria-hidden="true" className="block text-xs font-medium mb-1 invisible">
                Log
              </span>
              <button
                disabled={!selectedProgramId || isDataLoading || chapters.length === 0}
                onClick={() => {
                  setLogError(null);
                  setEditingLog(null);
                  setIsLogSessionModalOpen(true);
                }}
                className="px-5 py-2.5 bg-accent text-white text-base font-bold rounded-md shadow-sm hover:bg-accent-hover disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                + Log a class
              </button>
              <p className="mt-1 max-w-[13rem] text-right text-xs text-gray-500">
                Record a class after it&rsquo;s taught.
              </p>
            </div>
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
        <div className="bg-bg-card border border-border rounded-lg shadow-sm p-8 text-center text-gray-500">
          No curriculum-enabled Programs are available for this school.
        </div>
      ) : hasEmptyConfig ? (
        <div className="bg-bg-card border border-border rounded-lg shadow-sm p-8 text-center text-gray-500">
          No Curriculum configuration is available for this school.
        </div>
      ) : (
        <>
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

          {logError && !isLogSessionModalOpen && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">
              {logError}
            </div>
          )}
          {isDataLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-accent" />
            </div>
          ) : activeTab === "chapters" ? (
            <>
              {completionError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">
                  {completionError}
                </div>
              )}
              {canEdit &&
                chapters.length > 0 &&
                (() => {
                  const stats = calculateStats(chapters, progress);
                  return stats.chaptersCompleted === 0 && stats.topicsCovered === 0;
                })() && (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-hover-bg px-4 py-3 text-sm text-gray-600">
                    <span aria-hidden="true" className="text-accent">ⓘ</span>
                    <span>
                      Nothing logged{selectedSubject ? ` for ${selectedSubject}` : ""} yet.
                      After each class, use <b>+ Log a class</b> to record what you taught —
                      the chapters below fill in automatically.
                    </span>
                  </div>
                )}
              <ProgressSummary
                chapters={chapters}
                progress={progress}
                subjectTotalTimeMinutes={subjectTotalTimeMinutes}
              />
              <ChapterAccordion
                chapters={chapters}
                progress={progress}
                expandedChapterIds={expandedChapterIds}
                onToggleChapter={toggleChapter}
                canEdit={canEdit}
                onToggleChapterCompletion={handleToggleChapterCompletion}
                updatingChapterId={updatingCompletionChapterId}
              />
            </>
          ) : (
            <>
              <SessionHistory
                logs={logs}
                canEdit={canEdit}
                onEditLog={(log) => {
                  setLogError(null);
                  setEditingLog(log);
                  setIsLogSessionModalOpen(true);
                }}
                onDeleteLog={handleDeleteLog}
              />
            </>
          )}

          {isLogSessionModalOpen && (
            <LogSessionModal
              chapters={chapters}
              progress={progress}
              scopeLabel={[
                examTrackLabel(selectedExamTrack),
                selectedGrade ? `Grade ${selectedGrade}` : null,
                selectedSubject,
              ]
                .filter(Boolean)
                .join(" · ")}
              onClose={() => {
                setIsLogSessionModalOpen(false);
                setEditingLog(null);
                setLogError(null);
              }}
              onSave={handleSaveLog}
              isSaving={isSavingLog}
              error={logError}
              editLog={editingLog}
            />
          )}
        </>
      )}
    </div>
  );
}
