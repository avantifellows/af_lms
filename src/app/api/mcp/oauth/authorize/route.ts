import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getResolvedPermission } from "@/lib/permissions";
import {
  AUTH_CODE_TTL,
  CONSENT_TTL,
  clientFingerprint,
  mcpResource,
  publicOrigin,
  redirectUriRegistered,
  sign,
  verify,
  type AuthorizationRequest,
  type ClientPayload,
  type CodePayload,
} from "@/lib/mcp/oauth";

// Authorization endpoint. Identity comes from the user's normal LMS (NextAuth
// Google) session in this browser; no session → a sign-in page that returns
// here. A signed-in user must still approve explicitly: anyone can register a
// client, so approving silently would let a crafted link mint a token for
// whoever happens to be signed in.

type Consent = AuthorizationRequest & { email: string };

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const params = new URL(request.url).searchParams;

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const client = verify<ClientPayload>("client", clientId);
  // Until the client and redirect are known good, errors are shown here and
  // never sent to the redirect_uri (no open redirect).
  if (!client || client.iss !== origin) return page("Unknown application", "<p>This connector link is not valid. Remove the connector and add it again.</p>", 400);
  if (!redirectUriRegistered(client, redirectUri)) {
    return page("Invalid redirect", "<p>The application's redirect address is not the one it registered.</p>", 400);
  }

  const state = params.get("state") ?? undefined;
  const fail = (error: string, description: string) => redirectTo(redirectUri, { error, error_description: description, state });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const resource = params.get("resource");
  if (resource && resource !== mcpResource(origin)) return fail("invalid_target", "Unknown resource");

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return signInPage(request.url, origin);

  if (!(await getResolvedPermission(email))) {
    return page(
      "No LMS access",
      `<p>You're signed in as <b>${esc(email)}</b>, which has no access to the Avanti LMS, so this connector can't show you anything.</p><p>Ask your LMS admin for access, or sign in with a different account.</p>`,
      403,
    );
  }

  const consent = sign<Consent>(
    "consent",
    { email, client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state },
    CONSENT_TTL,
  );
  const appName = client.client_name || "An application";
  return page(
    "Connect to the Avanti LMS",
    `<p><b>${esc(appName)}</b> wants to read the LMS as <b>${esc(email)}</b>.</p>
<p>It will see what you can see in the LMS (schools, curriculum progress, test results) and nothing more. It can't change anything.</p>
<p class="muted">You'll be sent back to ${esc(new URL(redirectUri).host)}.</p>
<form method="post">
  <input type="hidden" name="consent" value="${esc(consent)}">
  <button name="decision" value="approve" class="primary">Allow</button>
  <button name="decision" value="deny">Cancel</button>
</form>`,
  );
}

export async function POST(request: Request) {
  const form = await request.formData();
  const consent = verify<Consent>("consent", String(form.get("consent") ?? ""));
  if (!consent) return page("Request expired", "<p>This approval page expired. Start the connection again from Claude.</p>", 400);

  // The approval must come from the same signed-in user the page was shown to.
  // The session cookie is SameSite=Lax, so a cross-site POST arrives without it.
  const session = await getServerSession(authOptions);
  if (session?.user?.email !== consent.email) {
    return page("Not signed in", "<p>Your LMS sign-in changed. Start the connection again from Claude.</p>", 403);
  }

  if (form.get("decision") !== "approve") {
    return redirectTo(consent.redirect_uri, {
      error: "access_denied",
      error_description: "The user declined",
      state: consent.state,
    });
  }

  const code = sign<CodePayload>(
    "code",
    {
      iss: publicOrigin(request),
      email: consent.email,
      cid: clientFingerprint(consent.client_id),
      redirect_uri: consent.redirect_uri,
      code_challenge: consent.code_challenge,
    },
    AUTH_CODE_TTL,
  );
  return redirectTo(consent.redirect_uri, { code, state: consent.state, iss: publicOrigin(request) });
}

function redirectTo(uri: string, params: Record<string, string | undefined>): Response {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
}

// NextAuth's Google sign-in is a POST carrying its CSRF token; fetch the token,
// then submit, returning to this exact authorize URL afterwards.
function signInPage(returnTo: string, origin: string): Response {
  const callbackUrl = new URL(new URL(returnTo).pathname + new URL(returnTo).search, origin).toString();
  return page(
    "Sign in to the Avanti LMS",
    `<p>Sign in with the Google account you use for the LMS to connect it to Claude.</p>
<form id="signin" method="post" action="/api/auth/signin/google">
  <input type="hidden" name="csrfToken" id="csrf">
  <input type="hidden" name="callbackUrl" value="${esc(callbackUrl)}">
  <button class="primary" type="submit">Sign in with Google</button>
</form>
<script>
document.getElementById("signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("/api/auth/csrf");
  document.getElementById("csrf").value = (await res.json()).csrfToken;
  e.target.submit();
});
</script>`,
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#1d2433;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;max-width:420px;margin:16px;padding:28px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{font-size:1.25rem;margin:0 0 12px}.muted{color:#667085;font-size:.9rem}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;cursor:pointer;margin-right:8px}
button.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  });
}
