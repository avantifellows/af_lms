# Pattern Index

Lookup table for all pattern files in this directory. Check here before starting any task — if a pattern exists, follow it.

<!-- This file is populated during setup (Pass 2) and updated whenever patterns are added.
     Each row maps a pattern file (or section) to its trigger — when should the agent load it?

     Format — simple (one task per file):
     | [filename.md](filename.md) | One-line description of when to use this pattern |

     Format — anchored (multi-section file, one row per task):
     | [filename.md#task-first-task](filename.md#task-first-task) | When doing the first task |
     | [filename.md#task-second-task](filename.md#task-second-task) | When doing the second task |

     Example (from a Flask API project):
     | [add-api-client.md](add-api-client.md) | Adding a new external service integration |
     | [debug-pipeline.md](debug-pipeline.md) | Diagnosing failures in the request pipeline |
     | [crud-operations.md#task-add-endpoint](crud-operations.md#task-add-endpoint) | Adding a new API route with validation |
     | [crud-operations.md#task-add-model](crud-operations.md#task-add-model) | Adding a new database model |

     Keep this table sorted alphabetically. One row per task (not per file).
     If you create a new pattern, add it here. If you delete one, remove it. -->

| Pattern | Use when |
|---------|----------|
| [add-api-route.md](add-api-route.md) | Adding any endpoint under `src/app/api/` (gate + read/write) |
| [add-component.md](add-component.md) | Adding a React component + its colocated Vitest/RTL test |
| [add-visit-action-type.md](add-visit-action-type.md) | Adding a new PM visit action type (the ~8-file registry change) |
| [db-service-write.md](db-service-write.md) | Writing students/batches/quiz-sessions/documents (proxy to the DB Service) |
| [debug-access-denied.md](debug-access-denied.md) | Diagnosing unexpected 401/403, empty lists, or wrongly-granted access |
