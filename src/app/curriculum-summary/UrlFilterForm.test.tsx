import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import UrlFilterForm from "./UrlFilterForm";

function renderForm() {
  return render(
    <UrlFilterForm action="/curriculum-summary" className="filters">
      <label>
        School
        <input type="search" name="q" defaultValue="anand" />
      </label>
      <label>
        <input type="checkbox" name="only_behind" value="1" defaultChecked={false} />
        Only behind
      </label>
    </UrlFilterForm>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UrlFilterForm", () => {
  it("renders a GET form with the given action", () => {
    const { container } = renderForm();

    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/curriculum-summary");
    expect(form).toHaveClass("filters");
  });

  // On a Back / Forward page load the browser restores the values typed before Apply; the
  // mount reset puts the URL's values back.
  it("resets the controls to their URL defaults when it mounts", () => {
    const reset = vi.spyOn(HTMLFormElement.prototype, "reset");

    renderForm();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("searchbox", { name: "School" })).toHaveValue("anand");
  });

  it("resets a page restored from the back/forward cache, and only that page", () => {
    const { unmount } = renderForm();
    const school = screen.getByRole("searchbox", { name: "School" }) as HTMLInputElement;
    const onlyBehind = screen.getByRole("checkbox", { name: "Only behind" }) as HTMLInputElement;
    school.value = "stale";
    onlyBehind.checked = true;

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(school).toHaveValue("stale");

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(school).toHaveValue("anand");
    expect(onlyBehind).not.toBeChecked();

    const reset = vi.spyOn(HTMLFormElement.prototype, "reset");
    unmount();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(reset).not.toHaveBeenCalled();
  });
});
