-- ============================================================================
-- 010_drop_capacity_from_inventory.sql
-- Drops the deprecated `inventory_items.capacity` column.
--
-- Background: capacity has been a per-design property since Phase 1 — it lives
-- on `mixes.components.capacity_override` and is the user's choice per cell
-- design (active material derating, lot-specific spec, etc.). The
-- `inventory_items.capacity` column was kept around for backward compat but
-- never written to since the Phase 1 cleanup. This finally removes it,
-- matching strategy doc decision 13.
--
-- ORDER OF OPERATIONS:
--   1. Frontend code already updated (no longer reads/writes inv.capacity).
--   2. Backend `models.py` and `schemas.py` no longer expose the field.
--   3. uvicorn restarted with the new code.
--   4. THIS SQL — drops the column.
--
-- If you run THIS before step 3, the running uvicorn won't crash (it just
-- ignores the column on read), but you'll have a brief window where the
-- model thinks the column exists and the DB doesn't. Safer to do the
-- backend restart first.
--
-- Idempotent: uses DROP COLUMN IF EXISTS.
-- ============================================================================

ALTER TABLE inventory_items DROP COLUMN IF EXISTS capacity;

-- Verification (run after the drop):
SELECT column_name FROM information_schema.columns
WHERE table_name = 'inventory_items' AND column_name = 'capacity';
-- Expected: ZERO ROWS.
