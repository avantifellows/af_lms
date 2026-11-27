import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RetryAlert } from "./RetryAlert";

describe("RetryAlert", () => {
  it("says what could not be loaded in an alert, and Retry calls onRetry", () => {
    const onRetry = vi.fn();
    render(<RetryAlert onRetry={onRetry}>Tests could not be loaded</RetryAlert>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Tests could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
