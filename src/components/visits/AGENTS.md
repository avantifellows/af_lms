# visits

## Purpose
Client-side components for PM school visit management — starting new visits with GPS tracking and ending active visits.

## Key Files
| File | Purpose |
|------|---------|
| `NewVisitForm.tsx` | Form to start a new visit with GPS location acquisition |
| `EndVisitButton.tsx` | Button to end an active visit with GPS location capture |

## Conventions

### GPS Pattern
Both components use the same `getAccurateLocation()` → `getAccuracyStatus()` flow from `@/lib/geolocation`:
1. Acquire GPS location (shows spinner + cancel button)
2. Check accuracy status ("good" or "moderate")
3. Submit to API with lat/lng/accuracy

### State Machine
Components use a discriminated union state type (`EndState` / GPS state) with statuses: `idle` → `acquiring` → `submitting` → `done` (or `error`).

### Props
- `NewVisitForm`: `{ udise: string }`
- `EndVisitButton`: `{ visitId: number, alreadyEnded: boolean }`

## Testing

### Mock Setup
```typescript
const mockGetAccurateLocation = vi.fn();
const mockGetAccuracyStatus = vi.fn(() => "good" as const);

vi.mock("@/lib/geolocation", () => ({
  getAccurateLocation: (...args: unknown[]) => mockGetAccurateLocation(...args),
  getAccuracyStatus: (...args: unknown[]) => mockGetAccuracyStatus(...args),
}));
```

### Observing Intermediate States
When a component transitions to `done` and returns `null`, hold the fetch promise open to observe intermediate states:
```typescript
let resolveFetch!: (value: unknown) => void;
vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { resolveFetch = r; })) as unknown as typeof fetch);
// ... trigger action, assert intermediate state ...
await act(async () => { resolveFetch({ ok: true, json: () => Promise.resolve({}) }); });
```

## Dependencies
- Depends on: `@/lib/geolocation` for GPS acquisition
- Used by: `src/app/school/[udise]/visit/new/page.tsx` (NewVisitForm), `src/app/visits/[id]/page.tsx` (EndVisitButton)
