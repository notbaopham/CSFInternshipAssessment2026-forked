# Architectural Proposal

## Biggest Architectural Issue

The codebase does not have a single source of truth for core data integrity rules. In particular, paddock occupancy is represented by a stored `animal_count` column that is manually updated in application code, while the rest of the system treats the database as the authoritative store. That split makes the model inconsistent by design: the app can forget to update counts, tests have to recreate bookkeeping by hand, and concurrent or out-of-band writes can silently drift from reality.

This is the most important architectural issue because it affects correctness across the whole product, not just one endpoint. It also creates a pattern that will repeat if more derived fields or cross-table invariants are added later.

## Target Design

Move invariant enforcement into the database and keep the application layer thin:

- The application should write only the user intent: create or move an animal, create a paddock, record a health event, record a weight.
- The database should enforce referential integrity, paddock capacity, and any occupancy-derived values.
- Read paths should derive occupancy from the animal table rather than trust a manually maintained counter.

## Concrete Fix

### 1. Stop storing occupancy as mutable state

Remove `animal_count` as a manually maintained column from `paddocks`.

Preferred options:

- Best option: derive occupancy in every query with `COUNT(*)` / `COUNT(a.id)` via a view.
- Acceptable fallback: keep the column only as a migration bridge, but make it database-maintained through triggers, never application-maintained.

For SQLite, a view is the simplest and most explicit long-term design:

```sql
CREATE VIEW paddocks_with_occupancy AS
SELECT
	p.id,
	p.name,
	p.capacity,
	COUNT(a.id) AS animal_count
FROM paddocks p
LEFT JOIN animals a ON a.paddock_id = p.id
GROUP BY p.id;
```

### 2. Enforce capacity in the database

Add triggers on `animals` inserts and updates so a paddock cannot be overfilled even if a caller bypasses the API.

Example shape:

```sql
CREATE TRIGGER animals_capacity_insert
BEFORE INSERT ON animals
WHEN NEW.paddock_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (
			SELECT COUNT(*)
			FROM animals
			WHERE paddock_id = NEW.paddock_id
		) >= (
			SELECT capacity
			FROM paddocks
			WHERE id = NEW.paddock_id
		)
		THEN RAISE(ABORT, 'Paddock is at capacity')
	END;
END;
```

Add the matching `BEFORE UPDATE OF paddock_id` trigger so moving animals is safe too.

### 3. Remove bookkeeping from route handlers

Refactor the animal create/update/move flows so they no longer increment or decrement paddock counts manually.

The route handlers should:

- validate request shape and obvious input errors
- write the requested animal change
- rely on SQLite to reject invalid transitions
- translate SQLite errors into user-facing HTTP responses

This keeps business rules close to the data and eliminates double-entry bookkeeping in the app.

### 4. Read occupancy through a dedicated query boundary

Create one backend query helper or repository function for paddock reads. That helper should return paddocks with computed occupancy so the frontend never depends on stale counters.

If the API contract must remain stable, the endpoint can keep returning `animal_count`, but it should now come from the derived query or view.

### 5. Update tests around the invariant

Replace tests that manually fix up `animal_count` with tests that verify the database enforces the invariant automatically.

Add coverage for:

- inserting an animal into a full paddock
- moving an animal into a full paddock
- deleting or reassigning an animal and observing occupancy change through reads, not manual updates

## Migration Plan

1. Add the view or trigger-based DB changes in a schema migration.
2. Update the API queries to read occupancy from the database-generated source.
3. Remove every manual `animal_count` write from the backend.
4. Rewrite tests so they assert invariants rather than implementing bookkeeping.
5. Delete the legacy mutable `animal_count` column once all code paths are migrated.

## Why This Is the Right Boundary

This app is small, but it already exposes the failure mode of mixed responsibility: the application and database both try to own the same invariant. That is the kind of architecture that works at first and then becomes fragile as soon as you add another endpoint, another script, or another developer.

The fix is not a bigger framework. It is a clearer boundary: the database owns integrity, and the application owns request handling and presentation.