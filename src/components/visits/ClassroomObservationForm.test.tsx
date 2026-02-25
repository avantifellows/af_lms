import { StrictMode, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ClassroomObservationForm from "./ClassroomObservationForm";
import { CURRENT_RUBRIC_VERSION } from "@/lib/classroom-observation-rubric";

interface HarnessProps {
  disabled?: boolean;
  initialData?: Record<string, unknown>;
}

function Harness({ disabled = false, initialData = {} }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return <ClassroomObservationForm data={data} setData={setData} disabled={disabled} />;
}

describe("ClassroomObservationForm", () => {
  it("stamps missing rubric_version via idempotent updater in strict mode", async () => {
    const setData = vi.fn();

    render(
      <StrictMode>
        <ClassroomObservationForm data={{}} setData={setData} disabled={false} />
      </StrictMode>
    );

    await waitFor(() => {
      expect(setData).toHaveBeenCalled();
    });

    const firstUpdater = setData.mock.calls[0]?.[0] as
      | ((value: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(typeof firstUpdater).toBe("function");

    const empty = {};
    const once = firstUpdater?.(empty) ?? {};
    const twice = firstUpdater?.(once) ?? {};
    const alreadyVersioned = { rubric_version: CURRENT_RUBRIC_VERSION };

    expect(once).toEqual({ rubric_version: CURRENT_RUBRIC_VERSION });
    expect(twice).toEqual(once);
    expect(firstUpdater?.(alreadyVersioned)).toBe(alreadyVersioned);
  });

  it("renders all 19 rubric cards with score summary and session summaries", () => {
    render(<Harness initialData={{ rubric_version: CURRENT_RUBRIC_VERSION }} />);

    expect(screen.getAllByTestId(/rubric-param-/)).toHaveLength(19);
    expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 0/45");
    expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 0/19");

    expect(screen.getByLabelText("Observer Summary (Strengths)")).toBeInTheDocument();
    expect(screen.getByLabelText("Observer Summary (Points of Improvement)")).toBeInTheDocument();
  });

  it("respects disabled prop for rubric controls and summaries", () => {
    render(
      <Harness
        disabled
        initialData={{
          rubric_version: CURRENT_RUBRIC_VERSION,
          observer_summary_strengths: "existing",
        }}
      />
    );

    const firstCard = screen.getByTestId("rubric-param-teacher_on_time");
    expect(within(firstCard).getByRole("radio", { name: /yes/i })).toBeDisabled();
    expect(within(firstCard).getByRole("button", { name: "Add remarks" })).toBeDisabled();
    expect(screen.getByLabelText("Observer Summary (Strengths)")).toBeDisabled();
  });

  it("updates live score/answered counts from valid selected scores only", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        initialData={{
          rubric_version: CURRENT_RUBRIC_VERSION,
          params: {
            time_management: { score: 0 },
          },
        }}
      />
    );

    expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 0/45");
    expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 0/19");

    const teacherOnTimeCard = screen.getByTestId("rubric-param-teacher_on_time");
    await user.click(within(teacherOnTimeCard).getByRole("radio", { name: /yes/i }));

    const recallCard = screen.getByTestId("rubric-param-recall_test");
    await user.click(within(recallCard).getByRole("radio", { name: /student interaction within time/i }));

    expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 3/45");
    expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 2/19");

    await user.type(screen.getByLabelText("Observer Summary (Strengths)"), "Good pace");
    await user.type(screen.getByLabelText("Observer Summary (Points of Improvement)"), "Board clarity");

    expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 3/45");
    expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 2/19");
  });

  it("keeps remarks visible after reveal even when cleared", async () => {
    const user = userEvent.setup();

    render(<Harness initialData={{ rubric_version: CURRENT_RUBRIC_VERSION }} />);

    const firstCard = screen.getByTestId("rubric-param-teacher_on_time");

    expect(within(firstCard).queryByLabelText("Remarks")).not.toBeInTheDocument();

    await user.click(within(firstCard).getByRole("button", { name: "Add remarks" }));

    const remarks = within(firstCard).getByLabelText("Remarks");
    await user.type(remarks, "Observed clear instructions");
    await user.clear(remarks);

    expect(within(firstCard).getByLabelText("Remarks")).toBeInTheDocument();
    expect(within(firstCard).queryByRole("button", { name: "Add remarks" })).not.toBeInTheDocument();
  });

  it("shows remarks textarea by default when remarks already exist", () => {
    render(
      <Harness
        initialData={{
          rubric_version: CURRENT_RUBRIC_VERSION,
          params: {
            teacher_on_time: { score: 1, remarks: "Already filled" },
          },
        }}
      />
    );

    const firstCard = screen.getByTestId("rubric-param-teacher_on_time");
    expect(within(firstCard).getByLabelText("Remarks")).toBeInTheDocument();
    expect(within(firstCard).queryByRole("button", { name: "Add remarks" })).not.toBeInTheDocument();
  });
});
