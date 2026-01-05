"use client";

import type { Topic } from "@/types/curriculum";

interface TopicRowProps {
  topic: Topic;
  isCompleted: boolean;
}

export default function TopicRow({ topic, isCompleted }: TopicRowProps) {
  return (
    <div className="px-4 py-2.5 pl-12 flex items-center gap-3">
      {/* Checkbox (read-only) */}
      <span
        className={`w-4 h-4 flex items-center justify-center rounded border ${
          isCompleted
            ? "bg-green-500 border-green-500 text-white"
            : "border-gray-300 bg-white"
        }`}
      >
        {isCompleted && (
          <svg
            className="w-3 h-3"
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
        )}
      </span>

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
