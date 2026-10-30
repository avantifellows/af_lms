import { BookOpen } from "lucide-react";

import type { Resource } from "@/lib/blended-learning-resources";

import { ExternalLink } from "./ExternalLink";

// Reading for Mentors, on the Resources tab (Mentors and admins alike), in
// the order Blended Learning Admins set on the Manage page.
export function MentorResources({ resources }: { resources: Resource[] }) {
  if (resources.length === 0) {
    return <p className="text-sm text-text-secondary">No resources yet.</p>;
  }
  return (
    <ul aria-label="Resources" className="space-y-1">
      {resources.map((resource) => (
        <li key={resource.id}>
          <ExternalLink href={resource.url} icon={BookOpen}>
            {resource.title}
          </ExternalLink>
        </li>
      ))}
    </ul>
  );
}
