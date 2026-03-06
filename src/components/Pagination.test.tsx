import { render, screen } from "@testing-library/react";
import Pagination from "./Pagination";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("Pagination", () => {
  it("returns null when totalPages <= 1", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} basePath="/schools" />
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when totalPages is 0", () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={0} basePath="/schools" />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows 'Page X of Y' text", () => {
    render(
      <Pagination currentPage={2} totalPages={5} basePath="/schools" />
    );
    // Text is split across child elements: "Page " <span>2</span> " of " <span>5</span>
    const pageInfo = screen.getByText(
      (_content, element) =>
        element?.tagName === "P" &&
        element.textContent === "Page 2 of 5"
    );
    expect(pageInfo).toBeInTheDocument();
  });

  it("renders page number links", () => {
    render(
      <Pagination currentPage={1} totalPages={3} basePath="/schools" />
    );
    expect(screen.getByRole("link", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3" })).toBeInTheDocument();
  });

  it("Previous is disabled (span) on first page", () => {
    render(
      <Pagination currentPage={1} totalPages={5} basePath="/schools" />
    );
    // sr-only "Previous" should NOT be inside a link
    const prevTexts = screen.getAllByText("Previous");
    // Mobile Previous is a span (cursor-not-allowed), not a link
    for (const el of prevTexts) {
      expect(el.closest("a")).toBeNull();
    }
  });

  it("Next is disabled (span) on last page", () => {
    render(
      <Pagination currentPage={5} totalPages={5} basePath="/schools" />
    );
    const nextTexts = screen.getAllByText("Next");
    for (const el of nextTexts) {
      expect(el.closest("a")).toBeNull();
    }
  });

  it("Previous and Next are links on a middle page", () => {
    render(
      <Pagination currentPage={3} totalPages={5} basePath="/schools" />
    );
    // sr-only "Previous" should be inside a link
    const prevSrOnly = screen.getByText("Previous", { selector: ".sr-only" });
    expect(prevSrOnly.closest("a")).not.toBeNull();

    const nextSrOnly = screen.getByText("Next", { selector: ".sr-only" });
    expect(nextSrOnly.closest("a")).not.toBeNull();
  });

  it("builds correct URLs with basePath", () => {
    render(
      <Pagination currentPage={2} totalPages={3} basePath="/schools" />
    );
    // Page 1 has no ?page param
    const page1Link = screen.getByRole("link", { name: "1" });
    expect(page1Link).toHaveAttribute("href", "/schools");

    // Page 3 has ?page=3
    const page3Link = screen.getByRole("link", { name: "3" });
    expect(page3Link).toHaveAttribute("href", "/schools?page=3");
  });

  it("builds URLs with searchParams preserved", () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={3}
        basePath="/schools"
        searchParams={{ search: "test" }}
      />
    );
    const page2Link = screen.getByRole("link", { name: "2" });
    expect(page2Link).toHaveAttribute(
      "href",
      expect.stringContaining("search=test")
    );
    expect(page2Link).toHaveAttribute(
      "href",
      expect.stringContaining("page=2")
    );
  });

  it("shows ellipsis for many pages", () => {
    render(
      <Pagination currentPage={5} totalPages={20} basePath="/schools" />
    );
    const ellipses = screen.getAllByText("...");
    expect(ellipses.length).toBeGreaterThanOrEqual(1);
  });

  it("does not show ellipsis when total pages is small", () => {
    render(
      <Pagination currentPage={2} totalPages={4} basePath="/schools" />
    );
    expect(screen.queryAllByText("...")).toHaveLength(0);
  });

  it("mobile view shows Previous/Next text and page fraction", () => {
    render(
      <Pagination currentPage={2} totalPages={5} basePath="/schools" />
    );
    // Mobile shows "2 / 5"
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    // Mobile Previous and Next as links
    const mobileLinks = screen.getAllByRole("link");
    const prevLink = mobileLinks.find((l) => l.textContent === "Previous");
    const nextLink = mobileLinks.find((l) => l.textContent === "Next");
    expect(prevLink).toBeDefined();
    expect(nextLink).toBeDefined();
  });
});
