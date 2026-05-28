import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GpsMapLink from "./GpsMapLink";

describe("GpsMapLink", () => {
  it("renders a Google Maps link with accuracy when coordinates are present", () => {
    render(<GpsMapLink lat={12.9716} lng={77.5946} accuracy={9.4} />);

    const link = screen.getByRole("link", { name: /open gps location/i });
    expect(link).toHaveAttribute("href", "https://maps.google.com/?q=12.9716,77.5946");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("9 m");
  });

  it("renders nothing when either coordinate is absent", () => {
    const { container, rerender } = render(<GpsMapLink lat={null} lng={77.5946} />);

    expect(container).toBeEmptyDOMElement();

    rerender(<GpsMapLink lat={12.9716} lng={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
