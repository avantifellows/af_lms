"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import Toast from "@/components/Toast";
import AnalysisModal from "./AnalysisModal";
import CycleCard from "./CycleCard";
import SetupModal, { type SetupResponse } from "./SetupModal";
import type { Cycle, FeedbackCentre } from "./types";

/**
 * Background refresh, so links the sessionCreator Lambda writes asynchronously
 * appear without a manual reload. Matches the Quiz Sessions tab's interval.
 */
const CYCLE_REFRESH_MS = 40000;

function TabHeader({ canEdit, onSetUp }: { canEdit: boolean; onSetUp: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b-4 border-border-accent px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Teacher Feedback</h2>
        {canEdit && (
          <button
            onClick={onSetUp}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover"
          >
            <span aria-hidden="true" className="relative inline-block h-3.5 w-3.5 shrink-0">
              <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-current" />
              <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current" />
            </span>
            <span>Set Up Feedback</span>
          </button>
        )}
      </div>
    </div>
  );
}

function RoundList({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-bg-card px-4 py-10 text-center text-sm text-text-secondary">
        Loading feedback rounds…
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-lg border border-border bg-bg-card-alt px-4 py-10 text-center text-sm text-text-secondary">
        No feedback rounds yet. Use “Set Up Feedback” to create one.
      </div>
    );
  }
  return <div className="space-y-3">{children}</div>;
}

function setupToast(result: SetupResponse): { variant: "success" | "info"; message: string } {
  return result.failedCount > 0
    ? { variant: "info", message: `Created ${result.createdCount}, ${result.failedCount} failed` }
    : { variant: "success", message: `Created ${result.createdCount} feedback form(s) for ${result.cycleLabel}` };
}

export default function TeacherFeedbackTab({
  schoolCode,
  canEdit,
  centreId,
}: {
  schoolCode: string;
  canEdit: boolean;
  // Set on a centre page: restricts both the rounds list and the setup centre
  // picker to this centre, so a centre page never shows a sibling centre's
  // feedback. Undefined on a school page, where the PM picks a centre.
  centreId?: number;
}) {
  const [centres, setCentres] = useState<FeedbackCentre[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loadingCentres, setLoadingCentres] = useState(true);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [analysisQuiz, setAnalysisQuiz] = useState<{ quizId: string; teacherName: string } | null>(null);
  // A round the setup nudge sent the PM to: opened and scrolled into view.
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ variant: "error" | "success" | "info"; message: string } | null>(null);

  const fetchCentres = useCallback(async () => {
    setLoadingCentres(true);
    try {
      const res = await fetch(
        `/api/teacher-feedback/centres?school_code=${encodeURIComponent(schoolCode)}` +
          (centreId === undefined ? "" : `&centre_id=${centreId}`),
        { cache: "no-store" }
      );
      const body = await res.json();
      setCentres(Array.isArray(body.centres) ? body.centres : []);
    } catch {
      setToast({ variant: "error", message: "Failed to load centres" });
    } finally {
      setLoadingCentres(false);
    }
  }, [schoolCode, centreId]);

  const fetchCycles = useCallback(async ({ background = false } = {}) => {
    // background: a periodic refresh must not flash the loading state or raise a
    // toast on a transient failure — the next tick retries.
    if (!background) setLoadingCycles(true);
    try {
      // no-store: links are filled asynchronously by the Lambda, so a cached
      // response would keep showing "Generating…" after they're ready.
      const res = await fetch(
        `/api/teacher-feedback/cycles?school_code=${encodeURIComponent(schoolCode)}` +
          (centreId === undefined ? "" : `&centre_id=${centreId}`),
        { cache: "no-store" }
      );
      const body = await res.json();
      setCycles(Array.isArray(body.cycles) ? body.cycles : []);
    } catch {
      if (!background) {
        setToast({ variant: "error", message: "Failed to load feedback rounds" });
      }
    } finally {
      if (!background) setLoadingCycles(false);
    }
  }, [schoolCode, centreId]);

  useEffect(() => {
    fetchCentres();
    fetchCycles();
  }, [fetchCentres, fetchCycles]);

  // The sessionCreator Lambda fills each session's links a few seconds after
  // setup returns, so a mount-only fetch leaves "Generating links…" on screen
  // until the user happens to reload. Same background refresh the Quiz Sessions
  // tab uses for its own async state.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchCycles({ background: true });
    }, CYCLE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchCycles]);

  return (
    <div className="space-y-4">
      {toast && (
        <Toast
          variant={toast.variant}
          message={toast.message}
          placement="bottom-right"
          autoDismissMs={4000}
          onDismiss={() => setToast(null)}
        />
      )}

      <TabHeader canEdit={canEdit} onSetUp={() => setIsCreateOpen(true)} />

      <RoundList loading={loadingCycles} empty={cycles.length === 0}>
        {cycles.map((c) => (
          <CycleCard
            // Remount on focus so the card opens even if it was rendered closed.
            key={c.setupRunId === focusRunId ? `${c.setupRunId}-focus` : c.setupRunId}
            cycle={c}
            canEdit={canEdit}
            focused={c.setupRunId === focusRunId}
            onAnalyze={(quizId, teacherName) => setAnalysisQuiz({ quizId, teacherName })}
            onCopy={(msg) => setToast({ variant: "success", message: msg })}
            onExtended={(message, variant) => {
              setToast({ variant, message });
              fetchCycles({ background: true });
            }}
          />
        ))}
      </RoundList>

      {isCreateOpen && (
        <SetupModal
          schoolCode={schoolCode}
          centres={centres}
          cycles={cycles}
          loading={loadingCentres}
          onClose={() => setIsCreateOpen(false)}
          onExtendInstead={(setupRunId) => {
            setIsCreateOpen(false);
            setFocusRunId(setupRunId);
          }}
          onDone={(result) => {
            setIsCreateOpen(false);
            setToast(setupToast(result));
            fetchCycles();
          }}
        />
      )}

      {analysisQuiz && (
        <AnalysisModal
          quizId={analysisQuiz.quizId}
          teacherName={analysisQuiz.teacherName}
          onClose={() => setAnalysisQuiz(null)}
        />
      )}
    </div>
  );
}
