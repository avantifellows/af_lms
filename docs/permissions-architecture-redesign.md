# Permissions Architecture Redesign

> **Note**: This document is superseded by [PERMISSION_SYSTEM_PROPOSAL.md](../PERMISSION_SYSTEM_PROPOSAL.md) which contains the full three-layer permission model. This file is kept for historical context on the original problem statement and migration plan.

## Problem Statement

Current permissions are role-based (teacher/PM/admin) without considering program type. Different programs (NVS, CoE, Nodal) have different feature requirements:

| Program | Available Roles | Features |
|---------|-----------------|----------|
| **NVS** | PM only | Student management only. No visits, curriculum, mentorship |
| **CoE/Nodal** | PM + Teacher | Full features: visits, curriculum, mentorship, analytics |

Additionally, schools can have students from multiple programs (e.g., JNV Bangalore Urban has CoE, NVS, and Nodal students). Users need to see all students for context but only edit students in their own programs.

## Current Solution

See [PERMISSION_SYSTEM_PROPOSAL.md](../PERMISSION_SYSTEM_PROPOSAL.md) for the full proposed design, which introduces:

1. **Three-layer model**: School scope (which schools) + Feature matrix (what you can do) + Program scope (which records you own)
2. **Feature permission matrix**: A single data structure mapping roles to feature access levels (none/view/edit)
3. **Per-record ownership**: `ownsRecord()` check using `program_ids` to control editability at the student level
4. **New `program_admin` role**: Scoped admin for a specific program (e.g., CoE Admin)

## Original Migration Plan (Still Relevant)

1. **Add `program_admin` role** — no schema change needed, `role` is varchar(50)
2. **Populate `program_ids`** for existing users based on current assignments
3. **Deploy code** that uses the feature matrix and ownership checks
4. **Remove passcodes** in separate deployment after users are migrated (timing TBD)
