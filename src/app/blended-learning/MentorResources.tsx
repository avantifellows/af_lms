import { BookOpen } from "lucide-react";

import { ExternalLink } from "./ExternalLink";

// Reading for Mentors, under their Student list (and an admin's view of it).
// One entry per theme doc; add more here.
const MENTOR_RESOURCES: { title: string; href: string }[] = [
  {
    title: "Mentor Toolkit: Supporting Students Through Non-Academic Stress",
    href: "https://docs.google.com/document/d/1kST-wRFTWgczw7SqBAxW97KNyJ0fzuBoOBsIelTQ8W0/edit?usp=sharing",
  },
];

export function MentorResources() {
  return (
    <section aria-labelledby="mentor-resources" className="space-y-1 border-t border-border pt-4">
      <h2 id="mentor-resources" className="text-xs font-bold uppercase tracking-wide text-text-secondary">
        Resources
      </h2>
      <ul>
        {MENTOR_RESOURCES.map((resource) => (
          <li key={resource.href}>
            <ExternalLink href={resource.href} icon={BookOpen}>
              {resource.title}
            </ExternalLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
