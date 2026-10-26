import { BookOpen } from "lucide-react";

import { ExternalLink } from "./ExternalLink";

// Reading for Mentors, on the Resources tab (Mentors and admins alike). One
// entry per theme doc; add more here.
const MENTOR_RESOURCES: { title: string; href: string }[] = [
  {
    title: "Mentor Toolkit: Supporting Students Through Non-Academic Stress",
    href: "https://docs.google.com/document/d/1kST-wRFTWgczw7SqBAxW97KNyJ0fzuBoOBsIelTQ8W0/edit?usp=sharing",
  },
];

export function MentorResources() {
  return (
    <ul aria-label="Resources" className="space-y-1">
      {MENTOR_RESOURCES.map((resource) => (
        <li key={resource.href}>
          <ExternalLink href={resource.href} icon={BookOpen}>
            {resource.title}
          </ExternalLink>
        </li>
      ))}
    </ul>
  );
}
