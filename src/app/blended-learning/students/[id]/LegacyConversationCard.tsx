import { FileText } from "lucide-react";

import { Card } from "@/components/ui";
import { formatCalendarDate } from "@/lib/blended-learning-format";
import type { LegacyConversation } from "@/lib/blended-learning-mentee-detail";

import { ExternalLink } from "../../ExternalLink";
import { LegacyActionItems } from "./LegacyActionItems";

// The latest conversation from the Student's Google Profile Doc, from before
// this app. Until the first Conversation is logged here it shows in full
// (date, summary, action items, link) near the top of the detail page (where
// Open Action Items sit), so a Mentor sees it while preparing, and in the log
// page's side panel instead of "No earlier Conversation". After that it is
// "Open from Profile Doc": the action items and link only, while one is
// still open. Its action items are ticked done here, by the Student's own
// Mentor only. Styled as the Last Conversation panel.

function Heading({ level: Tag, superseded }: { level: "h2" | "h3"; superseded: boolean }) {
  return (
    <Tag className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-muted">
      <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {superseded ? "Open from Profile Doc" : "Last Conversation · from Profile Doc"}
    </Tag>
  );
}

function Summary({ legacy }: { legacy: LegacyConversation }) {
  return (
    <>
      <div className="space-y-1">
        {legacy.occurredOn && (
          <p className="text-sm font-bold text-text-primary">{formatCalendarDate(legacy.occurredOn)}</p>
        )}
        <p className="text-xs text-text-secondary">Before this app. Shown until the first conversation is logged here.</p>
      </div>
      <p className="whitespace-pre-line break-words text-sm text-text-primary">{legacy.summary}</p>
    </>
  );
}

export function LegacyConversationCard({
  legacy,
  studentId,
  canTick,
  headingLevel = "h2",
}: {
  legacy: LegacyConversation;
  studentId: number;
  // The Student's own Mentor; everyone else sees the boxes disabled.
  canTick: boolean;
  headingLevel?: "h2" | "h3";
}) {
  const name = legacy.superseded ? "Open from Profile Doc" : "Last Conversation from Profile Doc";
  return (
    <section aria-label={name}>
      <Card elevation="sm" className="space-y-3 p-4">
        <Heading level={headingLevel} superseded={legacy.superseded} />
        {!legacy.superseded && <Summary legacy={legacy} />}
        {legacy.actionItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">Action items</p>
            {canTick && <p className="text-xs text-text-secondary">Tick what&apos;s done. It saves straight away.</p>}
            <LegacyActionItems
              studentId={studentId}
              initialItems={legacy.actionItems}
              canTick={canTick}
              superseded={legacy.superseded}
            />
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
