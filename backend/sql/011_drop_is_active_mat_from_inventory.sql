-- ============================================================================
-- 011_drop_is_active_mat_from_inventory.sql
-- Drops the deprecated `inventory_items.is_active_mat` column.
--
-- Rationale: same as the capacity column drop (010). Whether a chemical
-- "participates in capacity" is a per-design decision, not a catalog
-- property. The flag has been unused by the capacity calculation since
-- the unified Σ(wt% × cap) refactor — it just lingered in inventory
-- as a legacy boolean.
--
-- ORDER OF OPERATIONS:
--   1. Frontend code already updated (no longer reads/writes inv.is_active_mat).
--   2. Backend `models.py` and `schemas.py` no longer expose the field.
--   3. uvicorn restarted with the new code.
--   4. THIS SQL — drops the column.
--
-- Idempotent: uses DROP COLUMN IF EXISTS.
-- ============================================================================

ALTER TABLE inventory_items DROP COLUMN IF EXISTS is_active_mat;

-- Verification (run after the drop):
SELECT column_name FROM information_schema.columns
WHERE table_name = 'inventory_items' AND column_name = 'is_active_mat';
-- Expected: ZERO ROWS.
