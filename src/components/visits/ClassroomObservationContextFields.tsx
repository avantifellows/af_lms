"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEventHandler,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type {
  ClassroomObservationChapterOption,
  ClassroomObservationCurriculumOption,
  ClassroomObservationTopicOption,
} from "@/lib/classroom-observation-curriculum";
import { VALID_GRADES } from "@/lib/classroom-observation-rubric";
import { FormSection, Select } from "@/components/ui";

interface ClassroomObservationContextFieldsProps {
  data: Record<string, unknown>;
  setData: Dispatch<SetStateAction<Record<string, unknown>>>;
  disabled: boolean;
  schoolCode: string;
  selectedGrade: string;
}

interface CurriculumOptionsState {
  curricula: ClassroomObservationCurriculumOption[];
  chapters: ClassroomObservationChapterOption[];
  topics: ClassroomObservationTopicOption[];
}

const EMPTY_CURRICULUM_OPTIONS: CurriculumOptionsState = {
  curricula: [],
  chapters: [],
  topics: [],
};

const CHAPTER_FIELD_KEYS = [
  "chapter_id",
  "chapter_name",
  "chapter_code",
  "chapter_topic_count",
  "subject_id",
  "subject_name",
  "topic_id",
  "topic_name",
  "topic_code",
] as const;

const TOPIC_FIELD_KEYS = ["topic_id", "topic_name", "topic_code"] as const;

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null;
}

function clearFields(
  data: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const next = { ...data };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function chapterLabel(chapter: ClassroomObservationChapterOption): string {
  const suffix = chapter.code ? ` (${chapter.code})` : "";
  return `${chapter.subjectName} - ${chapter.name}${suffix}`;
}

function topicLabel(topic: ClassroomObservationTopicOption): string {
  const suffix = topic.code ? ` (${topic.code})` : "";
  return `${topic.name}${suffix}`;
}

function normalizeOptionsBody(body: unknown): CurriculumOptionsState {
  if (!body || typeof body !== "object") {
    return EMPTY_CURRICULUM_OPTIONS;
  }

  const record = body as Record<string, unknown>;
  return {
    curricula: Array.isArray(record.curricula) ? record.curricula : [],
    chapters: Array.isArray(record.chapters) ? record.chapters : [],
    topics: Array.isArray(record.topics) ? record.topics : [],
  };
}

async function loadCurriculumOptions(
  schoolCode: string,
  selectedGrade: string
): Promise<CurriculumOptionsState> {
  const params = new URLSearchParams({
    school_code: schoolCode,
    grade: selectedGrade,
  });
  const response = await fetch(`/api/pm/classroom-observation-options?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load curriculum options");
  }

  return normalizeOptionsBody(await response.json());
}

function useCurriculumOptions(schoolCode: string, selectedGrade: string) {
  const [options, setOptions] = useState<CurriculumOptionsState>(EMPTY_CURRICULUM_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOptions() {
      if (!(VALID_GRADES as readonly string[]).includes(selectedGrade)) {
        setOptions(EMPTY_CURRICULUM_OPTIONS);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const nextOptions = await loadCurriculumOptions(schoolCode, selectedGrade);
        if (!cancelled) {
          setOptions(nextOptions);
        }
      } catch {
        if (!cancelled) {
          setOptions(EMPTY_CURRICULUM_OPTIONS);
          setError("Failed to load curriculum options");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchOptions();

    return () => {
      cancelled = true;
    };
  }, [schoolCode, selectedGrade]);

  return { options, loading, error };
}

function CurriculumField({
  disabled,
  error,
  loading,
  options,
  selectedCurriculumId,
  selectedCurriculumName,
  onChange,
}: {
  disabled: boolean;
  error: string | null;
  loading: boolean;
  options: ClassroomObservationCurriculumOption[];
  selectedCurriculumId: number | null;
  selectedCurriculumName: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
}) {
  let content: ReactNode;
  if (disabled) {
    content = (
      <p className="text-sm text-text-primary" data-testid="curriculum-display">
        {selectedCurriculumName || "No curriculum selected"}
      </p>
    );
  } else if (loading) {
    content = <p className="text-sm text-text-muted" data-testid="curriculum-loading">Loading curriculum...</p>;
  } else if (error) {
    content = <p className="text-sm text-danger" data-testid="curriculum-error">{error}</p>;
  } else {
    content = (
      <Select
        value={selectedCurriculumId !== null ? String(selectedCurriculumId) : ""}
        onChange={onChange}
        className="w-full"
        data-testid="curriculum-select"
      >
        <option value="" disabled>
          {options.length === 0 ? "No curricula found" : "Select a curriculum"}
        </option>
        {options.map((curriculum) => (
          <option key={curriculum.id} value={String(curriculum.id)}>
            {curriculum.name}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <FormSection spacing="" data-testid="curriculum-selection">
      <h3 className="mb-2 text-sm font-semibold text-text-primary uppercase">Curriculum</h3>
      {content}
    </FormSection>
  );
}

function ChapterField({
  chapters,
  disabled,
  loading,
  selectedChapterId,
  selectedChapterName,
  selectedSubjectName,
  onChange,
}: {
  chapters: ClassroomObservationChapterOption[];
  disabled: boolean;
  loading: boolean;
  selectedChapterId: number | null;
  selectedChapterName: string;
  selectedSubjectName: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
}) {
  let content: ReactNode;
  if (disabled) {
    content = (
      <p className="text-sm text-text-primary" data-testid="chapter-display">
        {selectedChapterName
          ? `${selectedSubjectName ? `${selectedSubjectName} - ` : ""}${selectedChapterName}`
          : "No chapter selected"}
      </p>
    );
  } else if (loading) {
    content = <p className="text-sm text-text-muted" data-testid="chapter-loading">Loading chapters...</p>;
  } else {
    content = (
      <Select
        value={selectedChapterId !== null ? String(selectedChapterId) : ""}
        onChange={onChange}
        className="w-full"
        data-testid="chapter-select"
        disabled={chapters.length === 0}
      >
        <option value="" disabled>
          {chapters.length === 0 ? "No chapters found" : "Select a chapter"}
        </option>
        {chapters.map((chapter) => (
          <option key={`${chapter.curriculumId}-${chapter.id}`} value={String(chapter.id)}>
            {chapterLabel(chapter)}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <FormSection spacing="" data-testid="chapter-selection">
      <h3 className="mb-2 text-sm font-semibold text-text-primary uppercase">Chapter</h3>
      {content}
    </FormSection>
  );
}

function TopicField({
  disabled,
  loading,
  selectedTopicId,
  selectedTopicName,
  topics,
  onChange,
}: {
  disabled: boolean;
  loading: boolean;
  selectedTopicId: number | null;
  selectedTopicName: string;
  topics: ClassroomObservationTopicOption[];
  onChange: ChangeEventHandler<HTMLSelectElement>;
}) {
  return (
    <FormSection spacing="" data-testid="topic-selection">
      <h3 className="mb-2 text-sm font-semibold text-text-primary uppercase">Topic</h3>
      {disabled ? (
        <p className="text-sm text-text-primary" data-testid="topic-display">
          {selectedTopicName || "No topic selected"}
        </p>
      ) : loading ? (
        <p className="text-sm text-text-muted" data-testid="topic-loading">Loading topics...</p>
      ) : (
        <Select
          value={selectedTopicId !== null ? String(selectedTopicId) : ""}
          onChange={onChange}
          className="w-full"
          data-testid="topic-select"
          disabled={topics.length === 0}
        >
          <option value="">
            {topics.length === 0 ? "No topics found" : "No topic selected"}
          </option>
          {topics.map((topic) => (
            <option key={`${topic.curriculumId}-${topic.id}`} value={String(topic.id)}>
              {topicLabel(topic)}
            </option>
          ))}
        </Select>
      )}
    </FormSection>
  );
}

export default function ClassroomObservationContextFields({
  data,
  setData,
  disabled,
  schoolCode,
  selectedGrade,
}: ClassroomObservationContextFieldsProps) {
  const { options, loading, error } = useCurriculumOptions(schoolCode, selectedGrade);

  const selectedCurriculumId = readPositiveInteger(data.curriculum_id);
  const selectedCurriculumName = readString(data.curriculum_name);
  const selectedChapterId = readPositiveInteger(data.chapter_id);
  const selectedChapterName = readString(data.chapter_name);
  const selectedSubjectName = readString(data.subject_name);
  const selectedTopicId = readPositiveInteger(data.topic_id);
  const selectedTopicName = readString(data.topic_name);

  const chaptersForCurriculum = useMemo(() => {
    if (selectedCurriculumId === null) {
      return [];
    }
    return options.chapters.filter(
      (chapter) => chapter.curriculumId === selectedCurriculumId
    );
  }, [options.chapters, selectedCurriculumId]);

  const topicsForChapter = useMemo(() => {
    if (selectedCurriculumId === null || selectedChapterId === null) {
      return [];
    }
    return options.topics.filter(
      (topic) =>
        topic.curriculumId === selectedCurriculumId &&
        topic.chapterId === selectedChapterId
    );
  }, [options.topics, selectedChapterId, selectedCurriculumId]);

  const handleCurriculumChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const id = Number(event.target.value);
      const curriculum = options.curricula.find((option) => option.id === id);
      if (!curriculum) {
        return;
      }

      setData((current) => {
        const next = clearFields(current, CHAPTER_FIELD_KEYS);
        next.curriculum_id = curriculum.id;
        next.curriculum_name = curriculum.name;
        if (curriculum.code) {
          next.curriculum_code = curriculum.code;
        } else {
          delete next.curriculum_code;
        }
        return next;
      });
    },
    [options.curricula, setData]
  );

  const handleChapterChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const id = Number(event.target.value);
      const chapter = chaptersForCurriculum.find((option) => option.id === id);
      if (!chapter) {
        return;
      }

      setData((current) => {
        const next = clearFields(current, TOPIC_FIELD_KEYS);
        next.chapter_id = chapter.id;
        next.chapter_name = chapter.name;
        next.chapter_topic_count = chapter.topicCount;
        next.subject_id = chapter.subjectId;
        next.subject_name = chapter.subjectName;
        if (chapter.code) {
          next.chapter_code = chapter.code;
        } else {
          delete next.chapter_code;
        }
        return next;
      });
    },
    [chaptersForCurriculum, setData]
  );

  const handleTopicChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (!event.target.value) {
        setData((current) => clearFields(current, TOPIC_FIELD_KEYS));
        return;
      }

      const id = Number(event.target.value);
      const topic = topicsForChapter.find((option) => option.id === id);
      if (!topic) {
        return;
      }

      setData((current) => {
        const next = clearFields(current, TOPIC_FIELD_KEYS);
        next.topic_id = topic.id;
        next.topic_name = topic.name;
        if (topic.code) {
          next.topic_code = topic.code;
        }
        return next;
      });
    },
    [setData, topicsForChapter]
  );

  return (
    <>
      <CurriculumField
        disabled={disabled}
        error={error}
        loading={loading}
        options={options.curricula}
        selectedCurriculumId={selectedCurriculumId}
        selectedCurriculumName={selectedCurriculumName}
        onChange={handleCurriculumChange}
      />
      {selectedCurriculumId !== null && (
        <ChapterField
          chapters={chaptersForCurriculum}
          disabled={disabled}
          loading={loading}
          selectedChapterId={selectedChapterId}
          selectedChapterName={selectedChapterName}
          selectedSubjectName={selectedSubjectName}
          onChange={handleChapterChange}
        />
      )}
      {selectedCurriculumId !== null && selectedChapterId !== null && (
        <TopicField
          disabled={disabled}
          loading={loading}
          selectedTopicId={selectedTopicId}
          selectedTopicName={selectedTopicName}
          topics={topicsForChapter}
          onChange={handleTopicChange}
        />
      )}
    </>
  );
}
