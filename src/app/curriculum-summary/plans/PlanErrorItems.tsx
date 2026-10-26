import type { CurriculumPlanError } from "@/lib/curriculum-plans";

// The list items of a rejected plan save: "Chapter name: message", or just the message.
export default function PlanErrorItems({ errors }: { errors: CurriculumPlanError[] }) {
  return (
    <>
      {errors.map((error) => (
        <li key={`${error.chapterId ?? error.field}-${error.message}`}>
          {error.chapterName ? `${error.chapterName}: ` : ""}
          {error.message}
        </li>
      ))}
    </>
  );
}
