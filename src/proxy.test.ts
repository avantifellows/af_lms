import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetToken = vi.hoisted(() => vi.fn());

vi.mock("next-auth/jwt", () => ({
  getToken: mockGetToken,
}));

import { proxy, config } from "./proxy";

function makeRequest(pathname: string, cookies: string[] = []): NextRequest {
  const headers = new Headers();
  if (cookies.length > 0) headers.set("cookie", cookies.map((c) => `${c}=v`).join("; "));
  return new NextRequest("http://localhost:3000" + pathname, { headers });
}

function isNext(res: Response) {
  return res.headers.get("x-middleware-next") === "1";
}

function deletedCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const name = pair.split("=")[0];
    if (/max-age=0/i.test(line) || /expires=thu, 01 jan 1970/i.test(line)) out[name] = line;
  }
  return out;
}

const PASSCODE_TOKEN = {
  name: "School 70705",
  email: "passcode-70705@school.local",
  sub: "passcode-70705",
  schoolCode: "70705",
  isPasscodeUser: true,
};

describe("proxy (middleware)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("public routes", () => {
    it("allows unauthenticated access to login page", async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await proxy(makeRequest("/"));
      expect(isNext(res)).toBe(true);
    });

    it("redirects authenticated user from login page to dashboard", async () => {
      mockGetToken.mockResolvedValue({ email: "user@test.com" });
      const res = await proxy(makeRequest("/"));
      expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
      expect(deletedCookies(res)).toEqual({});
    });

    it("allows unauthenticated access to /api/auth routes", async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await proxy(makeRequest("/api/auth/callback"));
      expect(isNext(res)).toBe(true);
    });
  });

  describe("protected routes", () => {
    it("redirects unauthenticated user to login page", async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await proxy(makeRequest("/dashboard"));
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("allows authenticated user to access protected routes", async () => {
      mockGetToken.mockResolvedValue({ email: "user@test.com" });
      const res = await proxy(makeRequest("/dashboard"));
      expect(isNext(res)).toBe(true);
      expect(deletedCookies(res)).toEqual({});
    });

    it("allows authenticated user to access school routes", async () => {
      mockGetToken.mockResolvedValue({ email: "user@test.com" });
      const res = await proxy(makeRequest("/school/12345"));
      expect(isNext(res)).toBe(true);
    });

    it("allows a Dev Login token through", async () => {
      mockGetToken.mockResolvedValue({
        sub: "dev-admin",
        email: "e2e-holistic-global-admin@test.local",
        name: "Dev Admin",
      });
      const res = await proxy(makeRequest("/dashboard"));
      expect(isNext(res)).toBe(true);
      expect(deletedCookies(res)).toEqual({});
    });
  });

  describe("retired passcode tokens", () => {
    it("renders the login page instead of redirecting / to /dashboard", async () => {
      mockGetToken.mockResolvedValue(PASSCODE_TOKEN);
      const res = await proxy(makeRequest("/", ["next-auth.session-token"]));
      expect(isNext(res)).toBe(true);
      expect(res.headers.get("location")).toBeNull();
    });

    it("redirects protected routes to /", async () => {
      mockGetToken.mockResolvedValue(PASSCODE_TOKEN);
      const res = await proxy(makeRequest("/school/70705", ["next-auth.session-token"]));
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("treats a token with only a schoolCode claim as retired", async () => {
      mockGetToken.mockResolvedValue({ sub: "x", email: "a@gmail.com", schoolCode: "70705" });
      const res = await proxy(makeRequest("/dashboard"));
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("treats a token with only the isPasscodeUser marker as retired", async () => {
      mockGetToken.mockResolvedValue({ sub: "x", email: "a@gmail.com", isPasscodeUser: true });
      const res = await proxy(makeRequest("/dashboard"));
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("treats an upper-case passcode pseudo-user email as retired", async () => {
      mockGetToken.mockResolvedValue({ sub: "x", email: "PASSCODE-70705@SCHOOL.LOCAL" });
      const res = await proxy(makeRequest("/"));
      expect(isNext(res)).toBe(true);
    });

    it("deletes the plain and secure-prefixed session cookies", async () => {
      mockGetToken.mockResolvedValue(PASSCODE_TOKEN);
      const res = await proxy(makeRequest("/dashboard", ["next-auth.session-token"]));
      const deleted = deletedCookies(res);
      expect(Object.keys(deleted).sort()).toEqual([
        "__Secure-next-auth.session-token",
        "next-auth.session-token",
      ]);
      expect(deleted["__Secure-next-auth.session-token"]).toMatch(/secure/i);
    });

    it("deletes chunked session cookies present on the request", async () => {
      mockGetToken.mockResolvedValue(PASSCODE_TOKEN);
      const res = await proxy(
        makeRequest("/", [
          "__Secure-next-auth.session-token.0",
          "__Secure-next-auth.session-token.1",
          "next-auth.session-token.0",
          "unrelated-cookie",
        ])
      );
      expect(Object.keys(deletedCookies(res)).sort()).toEqual([
        "__Secure-next-auth.session-token",
        "__Secure-next-auth.session-token.0",
        "__Secure-next-auth.session-token.1",
        "next-auth.session-token",
        "next-auth.session-token.0",
      ]);
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
