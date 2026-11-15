import { Card } from "@/components/ui";
import { canBlendedLearning, type BlendedLearningAccess } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage } from "@/lib/blended-learning-guard";
import { countNewFlags } from "@/lib/blended-learning-flags";
import { listJeeFormRows } from "@/lib/blended-learning-jee-form";
import type { JeeFormRow } from "@/lib/blended-learning-jee-form-input";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../BlendedPageShell";
import { SECTION_TAB_TITLE, SectionTabs } from "../SectionTabs";
import { JeeFormTab } from "./JeeFormTab";

// The JEE Form tab: every Student in the viewer's scope (a Mentor's own
// Mentees; every Mentor's for a Blended Learning Admin, with a Mentor filter)
// with their JEE Main 2027 form status, recorded in place. The Mentor and
// Blended Learning Admins who aren't read-only record; read-only accounts
// view. The status filter, Mentor filter and open row are URL params read
// by the client list (`status`, `mentor`, `student`).

// The rows, or null when they can't be read (e.g. a database without the JEE
// form migration, or no "JEE Mains" exam row): the tab says so.
async function loadRows(access: BlendedLearningAccess): Promise<JeeFormRow[] | null> {
  try {
    return await listJeeFormRows(access);
  } catch (error) {
    console.error("Failed to load the JEE Form tab:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export default async function JeeFormPage() {
  const access = await requireBlendedLearningPage("view_list");
  const [chrome, newFlags, rows] = await Promise.all([
    loadDashboardChrome(access),
    countNewFlags(access),
    loadRows(access),
  ]);
  return (
    <BlendedPageShell access={access} chrome={chrome}>
      <div className="space-y-5">
        {/* The header's name isn't a heading, so the open tab names the page. */}
        <h1 className="sr-only">{SECTION_TAB_TITLE.jee_form}</h1>
        <SectionTabs
          kind={access.kind}
          current="jee_form"
          newFlags={newFlags}
          canManage={canBlendedLearning(access, "manage")}
        />
        {rows ? (
          <JeeFormTab
            rows={rows}
            canRecord={canBlendedLearning(access, "record_jee_form")}
            showMentor={access.kind === "admin"}
          />
        ) : (
          <Card elevation="sm" className="p-4 sm:p-6">
            <p className="text-sm text-text-secondary">The JEE form can&apos;t be shown right now.</p>
          </Card>
        )}
      </div>
    </BlendedPageShell>
  );
}
