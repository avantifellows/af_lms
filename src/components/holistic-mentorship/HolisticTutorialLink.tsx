import { BookOpen, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function HolisticTutorialLink({ schoolCode }: { schoolCode?: string }) {
  const href = schoolCode
    ? `/holistic-mentorship/tutorial?school_code=${encodeURIComponent(schoolCode)}`
    : "/holistic-mentorship/tutorial";

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="View tutorial"
      title="View tutorial"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-xs font-extrabold text-accent hover:bg-danger-bg hover:text-accent-hover"
    >
      <BookOpen aria-hidden="true" className="h-4 w-4" />
      <span className="hidden sm:inline">View tutorial</span>
      <ExternalLink aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />
    </Link>
  );
}
