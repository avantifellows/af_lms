// Passcode login was removed (ADR 0007). A JWT minted by the old passcode
// provider must never be honoured, nor passed on as a Google user.
// No DB or server-only imports: this module is shared by authOptions and proxy.

const PASSCODE_EMAIL = /^passcode-.*@school\.local$/i;

export function isRetiredToken(token: Record<string, unknown> | null | undefined): boolean {
  if (!token) return false;
  if ("isPasscodeUser" in token && token.isPasscodeUser !== undefined) return true;
  if ("schoolCode" in token && token.schoolCode !== undefined) return true;
  return typeof token.email === "string" && PASSCODE_EMAIL.test(token.email);
}
