# Agent Browser Testing Scratchpad

## Auth Setup

Cookie injection approach — generate NextAuth JWTs signed with the dev `NEXTAUTH_SECRET` and set via `document.cookie` before navigating.

### NEXTAUTH_SECRET

Read from `.env.local` (`NEXTAUTH_SECRET` variable).

### Test Users

Look up emails and roles from the `user_permission` table in the dev database. You need one user per role:
- `program_manager` — the PM who owns visits
- `program_admin` — read-only scoped access
- `admin` — full scoped read/write

### Token Generation Script
```bash
# Replace SECRET and email values from .env.local and user_permission table
node -e "
const { encode } = require('next-auth/jwt');
const SECRET = process.env.NEXTAUTH_SECRET || '<read from .env.local>';
const users = {
  pm:           { name: 'PM User',      email: '<pm email from DB>',           sub: 'pm-test' },
  programAdmin: { name: 'PA User',      email: '<program_admin email from DB>', sub: 'pa-test' },
  admin:        { name: 'Admin User',   email: '<admin email from DB>',         sub: 'admin-test' },
};
(async () => {
  for (const [role, payload] of Object.entries(users)) {
    const token = await encode({ token: payload, secret: SECRET });
    console.log(role + '=' + token);
  }
})();
"
```

### Login Flow (copy-paste ready)
```bash
# 1. Open headed browser
agent-browser open http://localhost:3000 --headed

# 2. Inject cookie (replace TOKEN with the generated value for desired role)
agent-browser eval "document.cookie = 'next-auth.session-token=TOKEN; path=/; SameSite=Lax'"

# 3. Reload to pick up session
agent-browser reload
```

### Where to find credentials
- **NEXTAUTH_SECRET**: `.env.local` → `NEXTAUTH_SECRET`
- **Test user emails**: `SELECT email, role FROM user_permission WHERE role IN ('program_manager', 'program_admin', 'admin');`
- **School codes**: `SELECT school_codes FROM user_permission WHERE email = '<pm email>';`

## Notes & Gotchas

- Tokens are JWE (encrypted), so they change each time you run the script — regenerate if needed
- Use `agent-browser cookies set next-auth.session-token "TOKEN"` for cookie injection
- `agent-browser eval` runs in page context (not Playwright context), so no `await` / no Playwright APIs
- After cookie injection + reload, the app redirects to the user's default landing page
- Use `--headed` flag to see the browser window during testing
- Use `agent-browser screenshot /tmp/name.png` to capture state at any point

### Geolocation Workaround (IMPORTANT)

`agent-browser set geo` sets coordinates but does NOT grant the browser permission.
The app's `getAccurateLocation()` (watchPosition) will hang on "Getting your location..."

**Workaround — use client-side navigation to preserve JS override:**
1. Navigate to an authenticated page (e.g., `/school/54026`) via full page load
2. Override the geolocation API via `eval`:
   ```bash
   agent-browser eval "
   const mockPos = { coords: { latitude: 23.2599, longitude: 77.4126, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() };
   navigator.geolocation.watchPosition = function(success) { setTimeout(function() { success(mockPos); }, 200); return 999; };
   navigator.geolocation.getCurrentPosition = function(success) { setTimeout(function() { success(mockPos); }, 200); };
   navigator.geolocation.clearWatch = function() {};
   'geo patched'
   "
   ```
3. Navigate to the GPS-requiring page via **client-side click** (not `agent-browser open`).
   Next.js client-side routing preserves the JS runtime, so the override survives.
   Example: click "School Visits" tab → "Start New Visit" link.
4. Full page reloads (agent-browser open, reload) will lose the override.

## Learned Patterns

### Geo Patch Survival
- The geolocation `eval` override is lost on **every full page navigation** (`agent-browser open`, `agent-browser reload`).
- Re-apply the geo patch after every full page load before clicking any GPS-dependent button (Start action, End action, Complete visit, Start visit).
- Client-side link clicks (Next.js router) preserve the patch — prefer those when possible.

### Efficient Rubric Filling
Chain all 19 radio clicks in one bash command with `&&`:
```bash
agent-browser click @e3 && agent-browser click @e6 && agent-browser click @e9 && ...
```
This is much faster than individual commands.

### Mobile Viewport Testing
```bash
agent-browser set viewport 390 844    # iPhone 12
agent-browser set viewport 1280 720   # Reset to desktop
```
No need to close/reopen the browser — viewport changes apply immediately.

### Role Switching
To switch roles mid-session, just:
1. Generate a new token for the target role
2. `agent-browser open <url> --headed` (fresh page load)
3. Inject the new cookie via `eval`
4. `agent-browser reload`

No need to close the browser — the new cookie overwrites the old one.

### Waiting for Async Operations
- After clicking Start/End/Complete/Add buttons, `agent-browser wait 2000-4000` is usually enough.
- For page navigations, `agent-browser wait --load networkidle` is more reliable.
- Always `agent-browser snapshot` or `screenshot` after waiting to verify the result.