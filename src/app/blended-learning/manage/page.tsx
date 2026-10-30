import { requireBlendedLearningPage } from "@/lib/blended-learning-guard";
import { listCommonActionItems, listTargetMentors } from "@/lib/blended-learning-common-action-items";
import { countNewFlags } from "@/lib/blended-learning-flags";
import { listResources } from "@/lib/blended-learning-resources";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../BlendedPageShell";
import { SectionTabs } from "../SectionTabs";
import { CommonActionItemsManager } from "./CommonActionItemsManager";
import { ResourcesManager } from "./ResourcesManager";

// The Manage tab, for Blended Learning Admins who may manage (a blended_admin
// or an LMS admin, not read-only): the Mentors' Resources, and Common Action
// Items pushed to Students. Anyone else is sent to the section's landing.
export default async function ManagePage() {
  const access = await requireBlendedLearningPage("manage", "/blended-learning");
  const [chrome, newFlags, resources, items, mentors] = await Promise.all([
    loadDashboardChrome(access),
    countNewFlags(access),
    listResources(),
    listCommonActionItems(access),
    listTargetMentors(access),
  ]);
  return (
    <BlendedPageShell access={access} chrome={chrome}>
      <div className="space-y-5">
        {/* The header's name isn't a heading, so the open tab names the page. */}
        <h1 className="sr-only">Manage</h1>
        <SectionTabs kind={access.kind} current="manage" newFlags={newFlags} canManage />
        <ResourcesManager resources={resources} />
        <CommonActionItemsManager items={items} mentors={mentors} />
      </div>
    </BlendedPageShell>
  );
}
