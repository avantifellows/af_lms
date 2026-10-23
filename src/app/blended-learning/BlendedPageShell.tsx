import type { ReactNode } from "react";

import { DashboardHeader, DashboardViewTabs } from "@/components/DashboardChrome";
import type { BlendedLearningAccess } from "@/lib/blended-learning-access";
import type { DashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedLearningHeader } from "./BlendedLearningHeader";

// Every Blended Learning page's content column: the log page's, centred at
// max-w-6xl. Every page uses it, for Mentors and admins alike, so going from
// the list to a Student to the log never moves the left edge or the width.
const PAGE_COLUMN = "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6";

// A Blended Learning page's frame. For an LMS user (`chrome` set) it sits
// inside the dashboard: the dashboard's header, then the tab strip with
// Blended Learning selected at the top of the page's column. The Blended
// Learning roles have no dashboard and get the section's own header.
export function BlendedPageShell({
  access,
  chrome,
  className = "",
  children,
}: {
  access: BlendedLearningAccess;
  chrome: DashboardChrome | null;
  className?: string;
  children: ReactNode;
}) {
  if (chrome) {
    return (
      <>
        <DashboardHeader
          email={chrome.email}
          permission={chrome.permission}
          totalCount={chrome.totalCount}
          features={chrome.features}
        />
        <main className={PAGE_COLUMN}>
          <DashboardViewTabs view={chrome.view} current="blended-learning" show={chrome.showViews} showBlended />
          <div className={className}>{children}</div>
        </main>
      </>
    );
  }
  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className={`${PAGE_COLUMN} ${className}`}>{children}</main>
    </>
  );
}
