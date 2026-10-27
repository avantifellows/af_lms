import { FileText } from "lucide-react";

import { Card } from "@/components/ui";
import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { LegacyConversation } from "@/lib/blended-learning-mentee-detail";

import { ExternalLink } from "../../ExternalLink";
import { OwnerPill } from "./ActionItemMeta";

// The latest conversation from the Student's Google Profile Doc, from before
// this app, until the first Conversation is logged here. Near the top of the
// detail page (where Open Action Items sit), so a Mentor sees it while
// preparing for the call, and in the log page's side panel instead of "No
// earlier Conversation". Styled as the Last Conversation panel.

export function LegacyConversationCard({
  legacy,
  headingLevel: Heading = "h2",
}: {
  legacy: LegacyConversation;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <section aria-label="Last Conversation from Profile Doc">
      <Card elevation="sm" className="space-y-3 p-4">
        <div className="space-y-1">
          <Heading className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-muted">
            <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Last Conversation · from Profile Doc
          </Heading>
          {legacy.occurredOn && (
            <p className="text-sm font-bold text-text-primary">{formatCalendarDate(legacy.occurredOn)}</p>
          )}
          <p className="text-xs text-text-secondary">Before this app. Shown until the first conversation is logged here.</p>
        </div>
        <p className="whitespace-pre-line break-words text-sm text-text-primary">{legacy.summary}</p>
        {legacy.actionItems.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">Action items</p>
            <ul aria-label="Action items from Profile Doc" className="space-y-2">
              {legacy.actionItems.map((item, index) => (
                <li key={index} className="flex items-baseline gap-2.5 text-sm text-text-primary">
                  <OwnerPill owner={item.owner} />
                  <span className="min-w-0 break-words">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {legacy.profileDocUrl && (
          <ExternalLink href={legacy.profileDocUrl} icon={FileText}>
            Open Profile Doc
          </ExternalLink>
        )}
      </Card>
    </section>
  );
}
