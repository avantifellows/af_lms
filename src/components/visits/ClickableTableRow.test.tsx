import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import Link from "next/link";

import ClickableTableRow from "./ClickableTableRow";

function renderRow() {
  return render(
    <table>
      <tbody>
        <ClickableTableRow href="/school-visit-summary/schools/SC001?preset=30d" className="hover:bg-hover">
          <td>Test School</td>
          <td>
            <Link href="/school-visit-summary/schools/SC001?preset=30d">Open School</Link>
          </td>
          <td>
            <button type="button">Menu</button>
          </td>
        </ClickableTableRow>
      </tbody>
    </table>
  );
}

beforeEach(() => {
  mockPush.mockReset();
});

describe("ClickableTableRow", () => {
  it("opens the row's page when a plain cell is clicked", () => {
    renderRow();

    fireEvent.click(screen.getByText("Test School"));

    expect(mockPush).toHaveBeenCalledWith("/school-visit-summary/schools/SC001?preset=30d");
  });

  it("leaves clicks on an inner link to the link itself", () => {
    renderRow();

    fireEvent.click(screen.getByRole("link", { name: "Open School" }));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("leaves clicks on an inner button to the button itself", () => {
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does nothing when an inner handler already prevented the click", () => {
    render(
      <table>
        <tbody>
          <ClickableTableRow href="/somewhere">
            <td onClick={(event) => event.preventDefault()}>Handled</td>
          </ClickableTableRow>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText("Handled"));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps the real link reachable by keyboard (the row itself is not a tab stop)", () => {
    renderRow();

    const row = screen.getByRole("row");
    expect(row).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("link", { name: "Open School" })).toHaveAttribute(
      "href",
      "/school-visit-summary/schools/SC001?preset=30d"
    );
    expect(row).toHaveClass("cursor-pointer", "hover:bg-hover");
  });
});
