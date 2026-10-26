import type { ReactNode } from "react";

// Blended Learning Mentoring section shell: light theme only, brand tokens,
// designed at 360 px first. Each page gates itself through the Blended
// Learning access policy (getBlendedLearningAccess) before reading anything.
export default function BlendedLearningLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text-primary [color-scheme:light]">
      {children}
    </div>
  );
}
