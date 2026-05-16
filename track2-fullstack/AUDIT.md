# FarmTracker Audit
## Overview
FarmTracker is readable and mostly functional, but it has high-risk weaknesses in data integrity, reliability, and frontend safety. The most significant architectural issue is denormalized paddock `animal_count`, which is manually maintained across create, move, and delete flows and can drift from actual assignments. This risk is visible in [track2-fullstack/app/backend/routes/animals.js](track2-fullstack/app/backend/routes/animals.js). Combined with non-atomic multi-step writes and inconsistent error handling, the system can produce corrupted state or unstable API behavior under failure conditions. Frontend rendering also introduces stored XSS risk through direct HTML injection of API data in [track2-fullstack/app/frontend/animals.html](track2-fullstack/app/frontend/animals.html) and [track2-fullstack/app/frontend/animal-detail.html](track2-fullstack/app/frontend/animal-detail.html).

Priority is therefore: correctness and safety first, API consistency second, then scalability and maintainability.

## Key Issues and Priorities
### P0: Correctness, Integrity, Security (Fix First)
- Animal-paddock operations are not atomic; partial failures can desynchronize paddock counts from real assignments.
- Multi-step writes are not consistently wrapped in transaction boundaries, so failure mid-flow can persist invalid state.
- Constraint violations are not consistently translated into safe, predictable client responses.
- Frontend pages render API-derived values directly into HTML, creating stored XSS risk if malicious values are persisted.

Why first: these issues directly threaten data trust, service stability, and baseline security.

### P1: API Consistency and UX Reliability (Fix Next)
- Pagination behavior is inconsistent between client and server semantics.
- Pagination lacks deterministic ordering, causing shifted or duplicated records across requests.
- Input validation is uneven across endpoints (bounds, type checks, and assignment constraints).
- Create/update status code behavior is inconsistent across routes.

Why next: these are user-visible correctness issues that reduce predictability and test reliability.

### P2: Scalability and Maintainability (Defer)
- Animal listing uses an N+1 enrichment pattern.
- Frontend error handling can fail silently.
- Date handling depends on string-format discipline.
- Runtime SQLite artifacts should be excluded from version control.
- `Paddock.id` is declared with AUTOINCREMENT, deleting table rows but not resetting the sequence, making IDs appear to randomly jump.

Why later: lower immediate risk than corruption, crash, and security, but important before production hardening, or only affecting reseeding/resetting db workflow in dev/test environment

## Execution Plan
1. Stabilize P0 with transactions, consistent error mapping, and safe rendering.
2. Align pagination, validation, and API contracts for P1.
3. Address performance and maintenance concerns in P2.