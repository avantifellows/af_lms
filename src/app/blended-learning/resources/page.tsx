import { requireBlendedLearningPage } from "@/lib/blended-learning-guard";
import { countNewFlags } from "@/lib/blended-learning-flags";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../BlendedPageShell";
import { MentorResources } from "../MentorResources";
import { SectionTabs } from "../SectionTabs";

// The Resources tab: reading for Mentors, for everyone with the section
// (admins see what their Mentors see), under the same tabs as the landing,
// Flags' "N new" included.
export default async function ResourcesPage() {
  const access = await requireBlendedLearningPage("view_list");
  const [chrome, newFlags] = await Promise.all([loadDashboardChrome(access), countNewFlags(access)]);
  return (
    <BlendedPageShell access={access} chrome={chrome}>
      <div className="space-y-5">
        {/* The header's name isn't a heading, so the open tab names the page. */}
        <h1 className="sr-only">Resources</h1>
        <SectionTabs kind={access.kind} current="resources" newFlags={newFlags} />
        <MentorResources />
      </div>
    </BlendedPageShell>
  );
}
