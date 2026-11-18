import { requireBlendedLearningPage } from "@/lib/blended-learning-guard";
import { listCommonActionItems, listTargetMentors } from "@/lib/blended-learning-common-action-items";
import { countNewFlags } from "@/lib/blended-learning-flags";
import { listResources } from "@/lib/blended-learning-resources";
import { listBlendedMentorOptions, listTeamLeadLinks } from "@/lib/blended-learning-team-leads";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../BlendedPageShell";
import { SectionTabs } from "../SectionTabs";
import { CommonActionItemsManager } from "./CommonActionItemsManager";
import { ResourcesManager } from "./ResourcesManager";
import { TeamLeadsManager } from "./TeamLeadsManager";

// The Manage tab, for Blended Learning Admins who may manage (a blended_admin
// or an LMS admin, not read-only): the Mentors' Resources, Common Action
// Items pushed to Students, and Team leads (who leads whom). Anyone else is
// sent to the section's landing.
export default async function ManagePage() {
  const access = await requireBlendedLearningPage("manage", "/blended-learning");
  const [chrome, newFlags, resources, items, mentors, teamLeads, blendedMentors] = await Promise.all([
    loadDashboardChrome(access),
    countNewFlags(access),
    listResources(),
    listCommonActionItems(access),
    listTargetMentors(access),
    listTeamLeadLinks(access),
    listBlendedMentorOptions(access),
  ]);
  return (
    <BlendedPageShell access={access} chrome={chrome}>
      <div className="space-y-5">
        {/* The header's name isn't a heading, so the open tab names the page. */}
        <h1 className="sr-only">Manage</h1>
        <SectionTabs kind={access.kind} current="manage" newFlags={newFlags} canManage />
        <ResourcesManager resources={resources} />
        <CommonActionItemsManager items={items} mentors={mentors} />
        <TeamLeadsManager links={teamLeads} mentors={blendedMentors} />
      </div>
    </BlendedPageShell>
  );
}
