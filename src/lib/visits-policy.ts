import type { Session } from "next-auth";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getResolvedPermission,
  type UserPermission,
  type UserRole,
} from "@/lib/permissions";

export interface ApiErrorBody {
  error: string;
  details?: string[];
}

export interface VisitsActor {
  email: string;
  permission: UserPermission;
  role: UserRole;
}

export interface VisitAccessTarget {
  pmEmail: string;
  schoolCode: string;
  schoolRegion?: string | null;
}

export interface ScopeResolution {
  exists: boolean;
  schoolRegion?: string;
}

interface SchoolRegionLookup {
  exists: boolean;
  schoolRegion: string | null;
}

export interface VisitScopePredicate {
  clause: string;
  params: unknown[];
}

type AccessMode = "view" | "edit";

type VisitsAccessResult =
  | { ok: true; actor: VisitsActor }
  | { ok: false; response: NextResponse<ApiErrorBody> };

type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse<ApiErrorBody> };

type SchoolRegionAccessResult =
  | { ok: true; schoolRegion: string | null }
  | { ok: false; response: NextResponse<ApiErrorBody> };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function apiError(
  status: number,
  error: string,
  details?: string[]
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = { error };
  if (details && details.length > 0) {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

export async function parseJsonBody(request: Request): Promise<JsonBodyResult> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, response: apiError(400, "Invalid JSON body") };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: apiError(400, "Invalid JSON body") };
  }
}

export function buildVisitsActor(email: string, permission: UserPermission): VisitsActor {
  return {
    email,
    permission,
    role: permission.role,
  };
}

async function findSchoolRegion(schoolCode: string): Promise<SchoolRegionLookup> {
  const schools = await query<{ region: string | null }>(
    `SELECT region FROM school WHERE code = $1`,
    [schoolCode]
  );

  if (schools.length === 0) {
    return { exists: false, schoolRegion: null };
  }

  return { exists: true, schoolRegion: schools[0].region ?? null };
}

export async function requireVisitsAccess(
  session: Session | null,
  mode: AccessMode
): Promise<VisitsAccessResult> {
  const email = session?.user?.email;

  if (!email) {
    return { ok: false, response: apiError(401, "Unauthorized") };
  }

  if (session.isPasscodeUser) {
    return {
      ok: false,
      response: apiError(403, "Passcode users cannot access visit routes"),
    };
  }

  const permission = await getResolvedPermission(email);
  if (!permission) {
    return { ok: false, response: apiError(403, "Forbidden") };
  }

  const access = getFeatureAccess(permission, "visits");
  if ((mode === "view" && !access.canView) || (mode === "edit" && !access.canEdit)) {
    return { ok: false, response: apiError(403, "Forbidden") };
  }

  return { ok: true, actor: buildVisitsActor(email, permission) };
}

export async function resolveSchoolRegionForScope(
  permission: UserPermission,
  schoolCode: string
): Promise<ScopeResolution> {
  if (permission.level !== 2) {
    return { exists: true };
  }

  const school = await findSchoolRegion(schoolCode);
  if (!school.exists) {
    return { exists: false };
  }

  return {
    exists: true,
    schoolRegion: school.schoolRegion ?? undefined,
  };
}

export async function resolveAccessibleVisitSchoolRegion(
  actor: VisitsActor,
  schoolCode: string
): Promise<SchoolRegionAccessResult> {
  const school = await findSchoolRegion(schoolCode);
  if (!canAccessVisitSchoolScope(actor, schoolCode, school.schoolRegion)) {
    return { ok: false, response: apiError(403, "Forbidden") };
  }

  return { ok: true, schoolRegion: school.schoolRegion };
}

export function buildVisitScopePredicate(
  actor: VisitsActor,
  options?: {
    startIndex?: number;
    schoolCodeColumn?: string;
    schoolRegionColumn?: string;
  }
): VisitScopePredicate {
  const startIndex = options?.startIndex ?? 1;
  const schoolCodeColumn = options?.schoolCodeColumn ?? "school_code";
  const schoolRegionColumn = options?.schoolRegionColumn ?? "school_region";

  if (actor.permission.level === 3) {
    return { clause: "", params: [] };
  }

  // Seat-derived schools from the resolved scope (B1). For level 1 the scope set
  // already unions explicit school_codes with seat schools, so it's the complete
  // school list; for level 2 it carries only seats (regions stay separate). Once
  // strict-exclusivity clears explicit school_codes for seated staff, this is the
  // ONLY thing keeping their visits in the list — so the SQL filter must read it.
  const scope = actor.permission.scope;
  const seatScopeSchools =
    scope && scope.schools !== "all" ? [...scope.schools] : null;

  if (actor.permission.level === 2) {
    const regions = actor.permission.regions ?? [];
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (regions.length > 0) {
      params.push(regions);
      conditions.push(
        `COALESCE(${schoolRegionColumn}, '') = ANY($${startIndex + params.length - 1})`
      );
    }
    if (seatScopeSchools && seatScopeSchools.length > 0) {
      params.push(seatScopeSchools);
      conditions.push(`${schoolCodeColumn} = ANY($${startIndex + params.length - 1})`);
    }
    if (conditions.length === 0) {
      return { clause: "1 = 0", params: [] };
    }
    return {
      clause: conditions.length > 1 ? `(${conditions.join(" OR ")})` : conditions[0],
      params,
    };
  }

  // Level 1: prefer the resolved scope set (explicit ∪ seats); fall back to raw
  // school_codes when scope isn't resolved (e.g. an actor built from a bare
  // permission), preserving the pre-seat behaviour.
  const schoolCodes = seatScopeSchools ?? actor.permission.school_codes ?? [];
  if (schoolCodes.length === 0) {
    return { clause: "1 = 0", params: [] };
  }

  return {
    clause: `${schoolCodeColumn} = ANY($${startIndex})`,
    params: [schoolCodes],
  };
}

export function isScopedVisitsRole(actor: VisitsActor): boolean {
  return actor.role === "admin" || actor.role === "program_admin";
}

export function requiresVisitActionsForCompletion(actor: VisitsActor): boolean {
  return actor.role === "program_manager";
}

export function canAccessVisitSchoolScope(
  actor: VisitsActor,
  schoolCode: string,
  schoolRegion?: string | null
): boolean {
  return canAccessSchoolSync(actor.permission, schoolCode, schoolRegion ?? undefined);
}

function hasScopedAccess(actor: VisitsActor, target: VisitAccessTarget): boolean {
  return canAccessVisitSchoolScope(actor, target.schoolCode, target.schoolRegion);
}

export function canViewVisit(actor: VisitsActor, target: VisitAccessTarget): boolean {
  if (actor.role === "admin" || actor.role === "program_admin") {
    return hasScopedAccess(actor, target);
  }

  if (actor.role === "program_manager") {
    return normalizeEmail(target.pmEmail) === normalizeEmail(actor.email);
  }

  return false;
}

export function canEditVisit(actor: VisitsActor, target: VisitAccessTarget): boolean {
  if (actor.role === "program_admin") {
    return hasScopedAccess(actor, target) &&
      normalizeEmail(target.pmEmail) === normalizeEmail(actor.email);
  }

  if (actor.role === "admin") {
    return hasScopedAccess(actor, target);
  }

  if (actor.role === "program_manager") {
    return normalizeEmail(target.pmEmail) === normalizeEmail(actor.email);
  }

  return false;
}

export function canEditCompletedActionData(actor: VisitsActor): boolean {
  return actor.role === "admin";
}

export function enforceVisitReadAccess(
  actor: VisitsActor,
  target: VisitAccessTarget
): NextResponse<ApiErrorBody> | null {
  if (!canViewVisit(actor, target)) {
    return apiError(403, "Forbidden");
  }

  return null;
}

export function enforceVisitWriteAccess(
  actor: VisitsActor,
  target: VisitAccessTarget
): NextResponse<ApiErrorBody> | null {
  if (!canEditVisit(actor, target)) {
    return apiError(403, "Forbidden");
  }

  return null;
}

export function enforceVisitWriteLock(
  status: string
): NextResponse<ApiErrorBody> | null {
  if (status === "completed") {
    return apiError(409, "Visit is completed and read-only");
  }

  return null;
}
