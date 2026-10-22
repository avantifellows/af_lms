import type { ReactNode } from "react";

import { DashboardHeader, DashboardViewTabs } from "@/components/DashboardChrome";
import type { BlendedLearningAccess } from "@/lib/blended-learning-access";
import type { DashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedLearningHeader } from "./BlendedLearningHeader";

// A Blended Learning page's frame. For an LMS user (`chrome` set) it sits
// inside the dashboard: the dashboard's header and tab strip, Blended
// Learning selected, the page below. The Blended Learning roles have no
// dashboard and get the section's own header. `width` is the page's own
// max width; inside the dashboard it caps the content under the tab strip.
// `padding` and `wideHeader` shape the section's own frame only.
export function BlendedPageShell({
  access,
  chrome,
  width,
  className = "",
  padding = "py-4 sm:py-6",
  wideHeader = width === "max-w-6xl",
  children,
}: {
  access: BlendedLearningAccess;
  chrome: DashboardChrome | null;
  width: "max-w-3xl" | "max-w-5xl" | "max-w-6xl";
  className?: string;
  padding?: string;
  wideHeader?: boolean;
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
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <DashboardViewTabs view={chrome.view} current="blended-learning" show={chrome.showViews} showBlended />
          <div className={`${width} ${className}`}>{children}</div>
        </main>
      </>
    );
  }
  return (
    <>
      <BlendedLearningHeader access={access} wide={wideHeader} />
      <main className={`mx-auto px-4 sm:px-6 ${padding} ${width} ${className}`}>{children}</main>
    </>
  );
}
