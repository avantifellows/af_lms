import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetToken = vi.hoisted(() => vi.fn());

vi.mock("next-auth/jwt", () => ({
  getToken: mockGetToken,
}));

// Mock NextResponse to capture redirect URLs and next() calls
const mockRedirectResponse = { type: "redirect" as const, url: "" };
const mockNextResponse = { type: "next" as const };

vi.mock("next/server", () => ({
  NextRequest: vi.fn(),
  NextResponse: {
    redirect: vi.fn((url: URL) => ({ ...mockRedirectResponse, url: url.toString() })),
    next: vi.fn(() => ({ ...mockNextResponse })),
  },
}));

import { proxy, config } from "./proxy";
import { NextResponse } from "next/server";

function makeRequest(pathname: string): {
  nextUrl: { pathname: string };
  url: string;
} {
  return {
    nextUrl: { pathname },
    url: "http://localhost:3000" + pathname,
  };
}

describe("proxy (middleware)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("public routes", () => {
    it("allows unauthenticated access to login page", async () => {
      mockGetToken.mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await proxy(makeRequest("/") as any);
      expect(result).toEqual({ type: "next" });
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it("redirects authenticated user from login page to dashboard", async () => {
      mockGetToken.mockResolvedValue({ email: "user@test.com" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await proxy(makeRequest("/") as any);
      expect(result.url).toContain("/dashboard");
      expect(NextResponse.redirect).toHaveBeenCalled();
    });

    it("allows unauthenticated access to /api/auth routes", async () => {
      mockGetToken.mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await proxy(makeRequest("/api/auth/callback") as any);
      expect(result).toEqual({ type: "next" });
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe("protected routes", () => {
    it("redirects unauthenticated user to login page", async () => {
      mockGetToken.mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await proxy(makeRequest("/dashboard") as any);
      expect(result.url).toContain("/");
      expect(NextResponse.redirect).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/" })
      );
    });

    it("allows authenticated user to access protected routes", async () => {
      mockGetToken.mockResolvedValue({ email: "user@test.com" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await proxy(makeRequest("/dashboard") as any);
      expect(result).toEqual({ type: "next" });
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it("allows authenticated user to access school routes", async () => {
      mockGetToken.mockResolvedValue({ email: "user@test.com" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await proxy(makeRequest("/school/12345") as any);
      expect(result).toEqual({ type: "next" });
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe("config", () => {
    it("exports matcher with correct route patterns", () => {
      expect(config.matcher).toEqual([
        "/",
        "/dashboard/:path*",
        "/school/:path*",
      ]);
    });
  });
});
