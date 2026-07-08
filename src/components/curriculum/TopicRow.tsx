"use client";

import type { Topic } from "@/types/curriculum";

interface TopicRowProps {
  topic: Topic;
  isCompleted: boolean;
}

export default function TopicRow({ topic, isCompleted }: TopicRowProps) {
  return (
    <div className="px-4 py-2.5 pl-12 flex items-center gap-3">
      {/* Read-only status marker: green check when taught, quiet ring otherwise.
          Not a control — topics are marked from what you log. */}
      <span className="w-4 h-4 flex items-center justify-center" aria-hidden="true">
        {isCompleted ? (
          <svg
            className="w-4 h-4 text-success"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-gray-300 bg-white" />
        )}
      </span>
      <span className="sr-only">{isCompleted ? "Taught" : "Not taught yet"}</span>

      {/* Topic Name */}
      <span
        className={`flex-1 text-sm ${
          isCompleted ? "text-gray-500" : "text-gray-700"
        }`}
      >
        {topic.name}
      </span>

      {/* Code (subtle) */}
      <span className="text-xs text-gray-400">{topic.code}</span>
    </div>
  );
}
