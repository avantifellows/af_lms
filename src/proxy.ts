import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { isRetiredToken } from "@/lib/retired-session";

const SESSION_COOKIE_BASES = ["next-auth.session-token", "__Secure-next-auth.session-token"];
const SESSION_COOKIE = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/;

// getToken skips the jwt callback, so retired passcode sessions are cleared here too.
function clearSessionCookies(request: NextRequest, response: NextResponse): NextResponse {
  const names = new Set(SESSION_COOKIE_BASES);
  for (const { name } of request.cookies.getAll()) {
    if (SESSION_COOKIE.test(name)) names.add(name);
  }
  for (const name of names) {
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const rawToken = await getToken({ req: request });
  const retired = isRetiredToken(rawToken);
  const token = retired ? null : rawToken;
  const { pathname } = request.nextUrl;
  const respond = (response: NextResponse) =>
    retired ? clearSessionCookies(request, response) : response;

  // Public routes - allow access
  if (pathname === "/" || pathname.startsWith("/api/auth")) {
    // If logged in and trying to access login page, redirect to dashboard
    if (pathname === "/" && token) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return respond(NextResponse.next());
  }

  // Protected routes - require authentication
  if (!token) {
    return respond(NextResponse.redirect(new URL("/", request.url)));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/school/:path*"],
};
