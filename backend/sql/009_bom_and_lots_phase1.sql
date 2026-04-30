-- ============================================================================
-- 009_bom_and_lots_phase1.sql
-- Phase 1 of the BOM + Lot integrated rollout (see docs/BOM_AND_LOT_INTEGRATED_STRATEGY_2026-04-24.md)
--
-- This file is intended to be pasted into Redash and run as a single
-- transaction. It is idempotent for re-runs:
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - CREATE TABLE IF NOT EXISTS
--   - INSERT ... WHERE NOT EXISTS  (for new inventory items)
--   - INSERT ... ON CONFLICT DO NOTHING (for legacy lots, due to UNIQUE constraint)
--
-- BEFORE running this:
--   1. Run 008_bom_match_preview.sql in Redash and review every WILL_INSERT_NEW
--      and WILL_OVERWRITE_COST row. Sanity check unit columns match.
--   2. If any expected match shows WILL_INSERT_NEW because of a name
--      typo, fix the inventory item name first via the Update Inventory
--      Item form, OR adjust the bom_name string below to match.
-- ============================================================================

BEGIN;

-- -----------------------------------------------------------------
-- 1. Schema additions on inventory_items
-- -----------------------------------------------------------------
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost_per_unit_gigascale FLOAT,
  ADD COLUMN IF NOT EXISTS bom_category VARCHAR(50);

COMMENT ON COLUMN inventory_items.cost_per_unit_gigascale
  IS 'Projected gigascale unit cost. Drives the BOM tab Gigascale toggle. NULL = unknown.';
COMMENT ON COLUMN inventory_items.bom_category
  IS 'Top-level BOM category for the cost pie chart: paste / mesh / tabs / separator / housing / electrolyte. NULL for non-BOM items (e.g. finished goods).';

-- -----------------------------------------------------------------
-- 2. inventory_lots table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_lots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_number        VARCHAR(100) NOT NULL,    -- 'unspecified' used when receive form left blank
  supplier          VARCHAR(255),
  received_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  qty_received      FLOAT NOT NULL,
  qty_remaining     FLOAT NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (inventory_item_id, lot_number)
);

CREATE INDEX IF NOT EXISTS idx_lots_item     ON inventory_lots(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_lots_received ON inventory_lots(received_date);

COMMENT ON TABLE inventory_lots
  IS 'Lot-level inventory tracking. inventory_items.quantity is the SUM(qty_remaining) of this items lots, kept in sync by trigger.';

-- -----------------------------------------------------------------
-- 3. Sync trigger to keep inventory_items.quantity in line with lots
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_inventory_quantity() RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
BEGIN
  target_id := COALESCE(NEW.inventory_item_id, OLD.inventory_item_id);
  UPDATE inventory_items
    SET quantity = COALESCE(
      (SELECT SUM(qty_remaining) FROM inventory_lots WHERE inventory_item_id = target_id),
      0
    ),
    updated_at = now()
  WHERE id = target_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_inv_qty ON inventory_lots;
CREATE TRIGGER trg_sync_inv_qty
AFTER INSERT OR UPDATE OR DELETE ON inventory_lots
FOR EACH ROW EXECUTE FUNCTION sync_inventory_quantity();

-- -----------------------------------------------------------------
-- 4. Wire lots into transactions
-- -----------------------------------------------------------------
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inv_txn_lot ON inventory_transactions(inventory_lot_id);

-- -----------------------------------------------------------------
-- 5. Migrate existing inventory items into legacy lots
--    Each item with quantity > 0 gets exactly one lot containing its current qty.
--    The trigger fires on each insert, recomputing inventory_items.quantity from
--    the new lots. End state: inventory_items.quantity == SUM(lots.qty_remaining)
--    item-by-item (no data loss, no surprise rebalancing).
-- -----------------------------------------------------------------
INSERT INTO inventory_lots (
  inventory_item_id, lot_number, qty_received, qty_remaining, supplier, notes
)
SELECT
  id,
  COALESCE(NULLIF(TRIM(lot_number), ''), 'unspecified'),
  quantity,
  quantity,
  supplier,
  'Auto-migrated from inventory_items at lot-system rollout (2026-04-24)'
FROM inventory_items
WHERE quantity > 0
ON CONFLICT (inventory_item_id, lot_number) DO NOTHING;

-- -----------------------------------------------------------------
-- 6. Insert new BOM-only inventory items
--    All idempotent (NOT EXISTS guard by name).
--    qty starts at 0 — receive a shipment to populate.
-- -----------------------------------------------------------------

-- Tabs / Electrode step
INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Patco 5560 Tape', 'tape', 'in', 0.009167, 'tabs',
       'BOM ref: 116 in/cell @ $1.06. Inserted by 009_bom_and_lots_phase1.sql.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Patco 5560 Tape'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'L-Shaped Copper Tabs', 'tab', 'pcs', 0.00, 'tabs',
       'BOM ref: not used in Gen2 cylindrical (qty 0). Kept for legacy designs.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('L-Shaped Copper Tabs'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'L-Shaped Ni-plated CRS Tabs', 'tab', 'pcs', 0.00, 'tabs',
       'BOM ref: not used in Gen2 cylindrical (qty 0). Kept for legacy designs.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('L-Shaped Ni-plated CRS Tabs'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Nickel Tab 0.005" (Dead Soft)', 'tab', 'ft', 0.19, 'tabs',
       'BOM ref: 2 ft/cell @ $0.38.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Nickel Tab 0.005" (Dead Soft)'));

-- Separator / Jelly Roll step
INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Embossed CWPVA', 'separator', 'm', 0.00, 'separator',
       'BOM ref: not used in Gen2 (qty 0).'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Embossed CWPVA'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Kraft Brown Paper (220 Ah)', 'separator', 'm', 0.00, 'separator',
       'BOM ref: not used in Gen2 (qty 0).'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Kraft Brown Paper (220 Ah)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Kraft Brown Paper (Prismatic)', 'separator', 'm', 0.00, 'separator',
       'BOM ref: prismatic format only (qty 0 in Gen2 cylindrical).'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Kraft Brown Paper (Prismatic)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Kapton Film Tape', 'tape', 'm', 0.5938, 'separator',
       'BOM ref: 0.1524 m/cell @ $0.09. Used during winding to secure jelly roll edges.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Kapton Film Tape'));

-- Housing / Dry Cell step
INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Cylindrical Cell Lids', 'packaging', 'pcs', 0.32, 'housing',
       'BOM ref: 1 lid/cell.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cylindrical Cell Lids'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Cell Terminal O-rings', 'packaging', 'pcs', 0.04, 'housing',
       'BOM ref: 2 o-rings/cell @ $0.08 total.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cell Terminal O-rings'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Cylindrical Cell Can (Rev 3)', 'packaging', 'pcs', 2.39, 'housing',
       'BOM ref: 1 can/cell.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cylindrical Cell Can (Rev 3)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Cell Terminals', 'packaging', 'pcs', 0.36, 'housing',
       'BOM ref: 2 terminals/cell @ $0.72 total.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cell Terminals'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Epoxy (Totalboat)', 'raw_chemical', 'L', 27.00, 'housing',
       'BOM ref: 0.047 L/cell @ $1.27. Cell sealing.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Epoxy (Totalboat)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Devcon Epoxy (O-rings)', 'raw_chemical', 'ml', 0.7000, 'housing',
       'BOM ref: 0.667 ml/cell @ $0.47. O-ring sealing.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Devcon Epoxy (O-rings)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Cell Labels (corrosion resistant)', 'packaging', 'pcs', 0.05, 'housing',
       'BOM ref: 1 label/cell.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cell Labels (corrosion resistant)'));

-- Electrolyte / Filled Cell step
INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'Electrolyte 25% KOH', 'electrolyte', 'kg', 3.8892, 'electrolyte',
       'BOM ref: 0.7 kg/cell @ $2.72.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Electrolyte 25% KOH'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, bom_category, notes)
SELECT 'G&B Vent Caps', 'packaging', 'pcs', 0.31, 'electrolyte',
       'BOM ref: 1 vent cap/cell.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('G&B Vent Caps'));

-- -----------------------------------------------------------------
-- 7. Mesh variants (collector category, bom_category=mesh)
--    User decision: every variant is its own inventory item.
-- -----------------------------------------------------------------

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
SELECT 'Nickel Mesh 6" (220 Ah)', 'collector', 'm', 2.9406, 0.16, 152.4, 'mesh',
       'Cathode mesh — 6" width. BOM ref: 2 m/cell @ $5.88.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Nickel Mesh 6" (220 Ah)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
SELECT 'Copper Mesh 6" (220 Ah)', 'collector', 'm', 1.4742, 0.149, 152.4, 'mesh',
       'Anode mesh — 6" width. BOM ref: 2 m/cell @ $2.95.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Copper Mesh 6" (220 Ah)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
SELECT 'Folded Edge Copper Mesh 5.6875"', 'collector', 'm', NULL, 0.149, 144.5, 'mesh',
       'OBSOLETE — kept for legacy designs.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Folded Edge Copper Mesh 5.6875"'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
SELECT 'Folded Edge Nickel Mesh 6.4375"', 'collector', 'm', NULL, 0.16, 163.5, 'mesh',
       'OBSOLETE — kept for legacy designs.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Folded Edge Nickel Mesh 6.4375"'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
SELECT 'Thick CRS Mesh (Prismatic)', 'collector', 'm', NULL, NULL, NULL, 'mesh',
       'Prismatic format only — qty 0 in Gen2 cylindrical.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Thick CRS Mesh (Prismatic)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
SELECT 'Thick Copper Mesh (Prismatic)', 'collector', 'm', NULL, NULL, NULL, 'mesh',
       'Prismatic format only — qty 0 in Gen2 cylindrical.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Thick Copper Mesh (Prismatic)'));

-- -----------------------------------------------------------------
-- 8. Backfill cost_per_unit + bom_category for items already in inventory
--    UPDATEs match by case-insensitive trimmed name. If a name has changed
--    in inventory and no longer matches, the UPDATE silently does nothing
--    — see verification queries at the end.
-- -----------------------------------------------------------------

-- Paste components
UPDATE inventory_items SET cost_per_unit = 6.402,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('EMD');
UPDATE inventory_items SET cost_per_unit = 5.5584,  bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Zinc Powder');
UPDATE inventory_items SET cost_per_unit = 12.28,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Graphite Imerys MX25');
UPDATE inventory_items SET cost_per_unit = 18.60,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Graphite Imerys BNB90');
UPDATE inventory_items SET cost_per_unit = 38.00,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Bismuth Oxide (Bi2O3)');
UPDATE inventory_items SET cost_per_unit = 7.89,    bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Calcium Hydroxide (Ca(OH)2)');
UPDATE inventory_items SET cost_per_unit = 3.92,    bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Zinc Oxide (ZnO)');
UPDATE inventory_items SET cost_per_unit = 0.00,    bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Acetylene Black');
UPDATE inventory_items SET cost_per_unit = 40.00,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Zirconia (ZrO2)');
UPDATE inventory_items SET cost_per_unit = 35.96,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Laponite');
UPDATE inventory_items SET cost_per_unit = 19.32,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Cathode PTFE');
UPDATE inventory_items SET cost_per_unit = 19.32,   bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('Anode PTFE');
UPDATE inventory_items SET cost_per_unit = 8.70,    bom_category = 'paste' WHERE LOWER(TRIM(name)) = LOWER('PEG 600');

-- Separator (existing items)
UPDATE inventory_items SET cost_per_unit = 0.6935,  bom_category = 'separator' WHERE LOWER(TRIM(name)) = LOWER('Chaoli-140');
UPDATE inventory_items SET cost_per_unit = 0.2296,  bom_category = 'separator' WHERE LOWER(TRIM(name)) = LOWER('Cellophane 7.0" 1-ply');

-- Catch-all bom_category backfills (safe to set on anything not yet categorized)
-- Existing separator/collector/tab inventory items get a default bom_category
-- so the BOM tab can group them even if not explicitly listed in the BOM.
UPDATE inventory_items SET bom_category = 'separator' WHERE category = 'separator' AND bom_category IS NULL;
UPDATE inventory_items SET bom_category = 'mesh'      WHERE category = 'collector' AND bom_category IS NULL;
UPDATE inventory_items SET bom_category = 'tabs'      WHERE category = 'tab'       AND bom_category IS NULL;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES — run these after the COMMIT to confirm everything's good.
-- These are READ-ONLY and outside the transaction so they always run.
-- ============================================================================

-- A. Schema sanity: are the new columns + table in place?
SELECT 'inventory_items columns' AS check_name,
       string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_name = 'inventory_items'
  AND column_name IN ('cost_per_unit_gigascale', 'bom_category')
GROUP BY 1;
-- Expected: 'cost_per_unit_gigascale, bom_category'

SELECT 'inventory_lots exists' AS check_name, count(*) AS row_count FROM inventory_lots;
-- Expected: row_count > 0 (one row per existing item with quantity > 0)

SELECT 'inventory_transactions has lot_id' AS check_name,
       column_name FROM information_schema.columns
WHERE table_name = 'inventory_transactions' AND column_name = 'inventory_lot_id';
-- Expected: 1 row

-- B. Quantity reconciliation: every item's quantity equals the SUM of its lots
SELECT i.id, i.name, i.quantity AS item_qty,
       COALESCE(SUM(l.qty_remaining), 0) AS lot_total,
       i.quantity - COALESCE(SUM(l.qty_remaining), 0) AS delta
FROM inventory_items i
LEFT JOIN inventory_lots l ON l.inventory_item_id = i.id
GROUP BY i.id, i.name, i.quantity
HAVING ABS(i.quantity - COALESCE(SUM(l.qty_remaining), 0)) > 0.0001
ORDER BY i.name;
-- Expected: ZERO ROWS. If any rows appear, the trigger isn't firing or
--   the migration left items out of sync — investigate before continuing.

-- C. BOM coverage: every BOM line either matches an inventory item with
--    cost_per_unit set, or was just inserted as a new row.
SELECT bom_category,
       COUNT(*) AS n_items,
       COUNT(*) FILTER (WHERE cost_per_unit IS NULL OR cost_per_unit = 0) AS missing_or_zero_cost,
       SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS in_stock
FROM inventory_items
WHERE bom_category IS NOT NULL
GROUP BY bom_category
ORDER BY bom_category;
-- Expected:
--   paste:       13 rows, ~0 missing  (Acetylene Black is legitimately $0)
--   mesh:        ≥6 rows, some NULL cost (obsolete and prismatic variants)
--   tabs:        ≥4 rows, 2 with $0 (legacy variants)
--   separator:   ≥4 rows
--   housing:     7 rows, all with cost
--   electrolyte: 2 rows, both with cost

-- D. Anything unexpected: items with bom_category but no recognizable category
SELECT id, name, category, bom_category, cost_per_unit
FROM inventory_items
WHERE bom_category IS NOT NULL
  AND category NOT IN ('raw_chemical','separator','collector','tab','tape','electrolyte','packaging','other');
-- Expected: ZERO ROWS.
