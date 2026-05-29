import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageThumbnail } from "./PageThumbnail";

describe("PageThumbnail", () => {
  it("renders the preview image and page number label", () => {
    render(<PageThumbnail previewUrl="blob:abc" pageNumber={3} />);
    const img = screen.getByAltText("Page 3 preview") as HTMLImageElement;
    expect(img.src).toContain("blob:abc");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not render a remove button without onRemove", () => {
    render(<PageThumbnail previewUrl="blob:x" pageNumber={1} />);
    expect(screen.queryByRole("button", { name: /remove page/i })).not.toBeInTheDocument();
  });

  it("calls onRemove when the X button is clicked", () => {
    const onRemove = vi.fn();
    render(<PageThumbnail previewUrl="blob:x" pageNumber={2} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove page 2/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("uses a custom alt when provided", () => {
    render(<PageThumbnail previewUrl="blob:x" pageNumber={1} alt="custom alt" />);
    expect(screen.getByAltText("custom alt")).toBeInTheDocument();
  });
});
