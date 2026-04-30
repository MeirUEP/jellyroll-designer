-- ============================================================================
-- 009_bom_and_lots_phase1.sql  (v2 — explicit UUID matching from inventory snapshot)
-- Phase 1 of the BOM + Lot integrated rollout.
-- See docs/BOM_AND_LOT_INTEGRATED_STRATEGY_2026-04-24.md
--
-- v2 changes vs v1:
--   * UPDATEs match by UUID (from the live snapshot 2026-04-24) instead of by name.
--   * Adds three new identifier columns (type, process_step, functionality).
--   * Adds lead_time_days for future dynamic-reorder-point math.
--   * Adds bom_category (drives the BOM tab pie chart).
--   * Migrates existing `category` values into the new identifiers.
--   * Splits packaging into cell- and module-typed items via the new `type` field.
--   * Stock-bearing unit mismatches (EMD lbs, Electrolyte 25% KOH L) get the
--     COST converted to fit the existing unit; the unit itself is preserved
--     so existing stock counts stay valid. Zero-stock unit mismatches
--     (Patco, Cellophane, Kapton, Folded Edge meshes, Epoxy Totalboat) get
--     their unit updated to the BOM unit.
--   * `inventory_items.capacity` is NOT dropped here (would break backend
--     SELECTs until a uvicorn restart with updated models). Marked
--     deprecated; cleanup in a separate phase.
--
-- BEFORE running:
--   * Read this file end to end.
--   * Snapshot is from 2026-04-24. If you've added/deleted inventory items
--     since then, run a quick `SELECT id, name FROM inventory_items` to check
--     the UUIDs in section 5 still resolve.
-- ============================================================================

BEGIN;

-- =========================================================================
-- 1. Schema additions on inventory_items
-- =========================================================================
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost_per_unit_gigascale FLOAT,
  ADD COLUMN IF NOT EXISTS bom_category VARCHAR(50),     -- paste / mesh / tabs / separator / housing / electrolyte
  ADD COLUMN IF NOT EXISTS type VARCHAR(50),             -- raw_chemical, separator, mesh, tab, can, lid, terminal, ...
  ADD COLUMN IF NOT EXISTS process_step VARCHAR(50),     -- paste, electrode, winding, cell_assembly, module_assembly
  ADD COLUMN IF NOT EXISTS functionality VARCHAR(50),    -- active_material, conductor, binder, separator, ...
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;       -- for dynamic-reorder-point math (Phase 6)

COMMENT ON COLUMN inventory_items.cost_per_unit_gigascale IS 'Projected gigascale unit cost. Drives BOM tab Gigascale toggle.';
COMMENT ON COLUMN inventory_items.bom_category            IS 'Top-level BOM category for cost pie chart.';
COMMENT ON COLUMN inventory_items.type                    IS 'Physical/material classification. Replaces legacy category.';
COMMENT ON COLUMN inventory_items.process_step            IS 'When the item is consumed in production.';
COMMENT ON COLUMN inventory_items.functionality           IS 'Role the item plays in the cell/module.';
COMMENT ON COLUMN inventory_items.capacity                IS 'DEPRECATED — capacity is a design property (see mixes.components.capacity_override). Do not write new values.';

-- =========================================================================
-- 2. inventory_lots table
-- =========================================================================
CREATE TABLE IF NOT EXISTS inventory_lots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_number        VARCHAR(100) NOT NULL,
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
  IS 'Lot-level inventory tracking. inventory_items.quantity is the SUM(qty_remaining) of an items lots, kept in sync by trigger.';

-- =========================================================================
-- 3. Sync trigger: inventory_items.quantity = SUM(inventory_lots.qty_remaining)
-- =========================================================================
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

-- =========================================================================
-- 4. Wire lots into transactions
-- =========================================================================
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inv_txn_lot ON inventory_transactions(inventory_lot_id);

-- =========================================================================
-- 5. Backfill type / process_step / functionality / bom_category / cost
--    on existing items by UUID (snapshot 2026-04-24).
--
--    Three sub-blocks:
--      5a. Generic defaults from legacy `category`
--      5b. Refinements for packaging (split by name into can/lid/terminal/etc.)
--      5c. Specific UUID-targeted UPDATEs for BOM-matched items (cost + identifiers)
-- =========================================================================

-- --- 5a. Generic defaults: type / process_step / functionality from category
UPDATE inventory_items SET type = category WHERE type IS NULL;

-- collectors → mesh (except mis-categorized "Nickel Tab .005" entries)
UPDATE inventory_items
   SET type = CASE WHEN name ILIKE '%nickel tab%' THEN 'tab' ELSE 'mesh' END
 WHERE category = 'collector';

-- electrolyte → electrolyte
UPDATE inventory_items SET type = 'electrolyte' WHERE category = 'electrolyte' AND type = 'electrolyte';

-- electronics → pcb
UPDATE inventory_items SET type = 'pcb' WHERE category = 'electronics' AND name ILIKE 'pcb%';

-- finished_good stays as-is

-- 5b. Packaging split — refine type from name patterns
UPDATE inventory_items SET type = 'can'             WHERE category = 'packaging' AND (name ILIKE '%cell can%' OR name ILIKE 'cc5 cell can%' OR name ILIKE 'cylindrical cell rev%');
UPDATE inventory_items SET type = 'lid'             WHERE category = 'packaging' AND (name ILIKE '%cell lid%'  OR name ILIKE 'cc5 cell lid%');
UPDATE inventory_items SET type = 'o_ring'          WHERE category = 'packaging' AND  name ILIKE '%o-ring%';
UPDATE inventory_items SET type = 'terminal'        WHERE category = 'packaging' AND  name ILIKE 'cell terminal%' AND name NOT ILIKE '%o-ring%';
UPDATE inventory_items SET type = 'label'           WHERE category = 'packaging' AND  name ILIKE '%label%';
UPDATE inventory_items SET type = 'vent_cap'        WHERE category = 'packaging' AND  name ILIKE '%vent cap%';
UPDATE inventory_items SET type = 'busbar'          WHERE category = 'packaging' AND  name ILIKE 'busbar%';
UPDATE inventory_items SET type = 'fastener'        WHERE category = 'packaging' AND (name ILIKE '%screws%' OR name ILIKE '%bolt%' OR name ILIKE '%washer%');
UPDATE inventory_items SET type = 'module_terminal' WHERE category = 'packaging' AND  name ILIKE 'battery terminal%';
UPDATE inventory_items SET type = 'module_box'      WHERE category = 'packaging' AND (name ILIKE '%battery box%' OR name ILIKE '%battery lid%' OR name ILIKE 'black battery%' OR name ILIKE 'grey battery%');
UPDATE inventory_items SET type = 'module_handle'   WHERE category = 'packaging' AND (name ILIKE 'module handle%' OR name ILIKE 'module rope%');
UPDATE inventory_items SET type = 'sleeve'          WHERE category = 'packaging' AND  name ILIKE '%sleeve%';
UPDATE inventory_items SET type = 'epoxy'           WHERE name ILIKE '%epoxy%';

-- 5a (cont). process_step defaults
UPDATE inventory_items SET process_step = 'paste'           WHERE process_step IS NULL AND category = 'raw_chemical';
UPDATE inventory_items SET process_step = 'winding'         WHERE process_step IS NULL AND category = 'separator';
UPDATE inventory_items SET process_step = 'electrode'       WHERE process_step IS NULL AND type IN ('mesh','tab');
UPDATE inventory_items SET process_step = 'electrode'       WHERE process_step IS NULL AND category = 'tape' AND name ILIKE '%patco%';
UPDATE inventory_items SET process_step = 'winding'         WHERE process_step IS NULL AND category = 'tape';
UPDATE inventory_items SET process_step = 'cell_assembly'   WHERE process_step IS NULL AND (category = 'electrolyte' OR type IN ('can','lid','terminal','o_ring','label','vent_cap','epoxy'));
UPDATE inventory_items SET process_step = 'module_assembly' WHERE process_step IS NULL AND (type IN ('busbar','fastener','module_terminal','module_box','module_handle','sleeve','pcb') OR category = 'electronics');

-- 5a (cont). functionality defaults
UPDATE inventory_items SET functionality = 'conductor'             WHERE functionality IS NULL AND category = 'raw_chemical' AND (name ILIKE '%graphite%' OR name ILIKE '%acetylene%');
UPDATE inventory_items SET functionality = 'binder'                WHERE functionality IS NULL AND category = 'raw_chemical' AND name ILIKE '%ptfe%';
UPDATE inventory_items SET functionality = 'performance_additive'  WHERE functionality IS NULL AND category = 'raw_chemical';
UPDATE inventory_items SET functionality = 'separator'             WHERE functionality IS NULL AND type = 'separator';
UPDATE inventory_items SET functionality = 'current_collector'     WHERE functionality IS NULL AND type = 'mesh';
UPDATE inventory_items SET functionality = 'electrical_connection' WHERE functionality IS NULL AND type IN ('tab','terminal','module_terminal','busbar','pcb');
UPDATE inventory_items SET functionality = 'structural'            WHERE functionality IS NULL AND type IN ('tape','can','lid','module_box','module_handle','sleeve','fastener');
UPDATE inventory_items SET functionality = 'sealant'               WHERE functionality IS NULL AND type IN ('o_ring','epoxy','vent_cap');
UPDATE inventory_items SET functionality = 'label'                 WHERE functionality IS NULL AND type = 'label';
UPDATE inventory_items SET functionality = 'active_material'       WHERE functionality IS NULL AND category = 'electrolyte';

-- =========================================================================
-- 5c. UUID-targeted backfill: cost_per_unit, bom_category, type/process/func
--     overrides for the BOM-matched items, plus active_material flagging
--     for the two paste actives (EMD, Zinc Powder).
--
--     Cost values for stock-bearing items are pre-converted to the
--     existing inventory unit:
--       EMD               $6.402/kg → $2.9039/lb (1 kg = 2.20462 lb)
--       Electrolyte 25% KOH $3.8892/kg → $4.823/L (assume 1.24 kg/L density)
--     Zero-stock unit mismatches get their unit updated to the BOM unit.
-- =========================================================================

-- Paste components (cost only — type/process/functionality already set above)
UPDATE inventory_items SET cost_per_unit = 5.5584,  bom_category = 'paste', functionality = 'active_material'      WHERE id = '3b7cbc26-6c14-425e-a305-efd26756b1c4'; -- Zinc Powder
UPDATE inventory_items SET cost_per_unit = 12.28,   bom_category = 'paste', functionality = 'conductor'             WHERE id = '7a961b0c-053c-4f22-95c5-abebcf5bfb6a'; -- Graphite Imerys MX25
UPDATE inventory_items SET cost_per_unit = 2.9039,  bom_category = 'paste', functionality = 'active_material'      WHERE id = '4949da8f-7cef-404d-9308-28ae041ab8ed'; -- EMD ($/lb)
UPDATE inventory_items SET cost_per_unit = 18.60,   bom_category = 'paste', functionality = 'conductor'             WHERE id = '011e4350-f1ff-4a2d-ba43-4c36dcabb6ef'; -- Graphite Imerys BNB90
UPDATE inventory_items SET cost_per_unit = 38.00,   bom_category = 'paste', functionality = 'performance_additive' WHERE id = '0e7c375c-8ca5-4cea-9cc3-3599b682ac49'; -- Bismuth Oxide
UPDATE inventory_items SET cost_per_unit = 7.89,    bom_category = 'paste', functionality = 'performance_additive' WHERE id = 'b4affb47-4c47-4ffb-80ce-e6a96f2e05c2'; -- Calcium Hydroxide
UPDATE inventory_items SET cost_per_unit = 3.92,    bom_category = 'paste', functionality = 'performance_additive' WHERE id = '5833a1dc-38ef-44c0-9127-2e9f4e7cf4a2'; -- Zinc Oxide
UPDATE inventory_items SET cost_per_unit = 35.96,   bom_category = 'paste', functionality = 'performance_additive' WHERE id = '35dd4d0d-cdac-4cea-9e05-c8966c6bd30f'; -- Laponite
UPDATE inventory_items SET cost_per_unit = 19.32,   bom_category = 'paste', functionality = 'binder'                WHERE id = '22da288d-915f-4e75-b4f9-bf4dd519612a'; -- Cathode PTFE
UPDATE inventory_items SET cost_per_unit = 19.32,   bom_category = 'paste', functionality = 'binder'                WHERE id = '9b5506aa-44f8-4495-8375-e47c7b687bee'; -- Anode PTFE
UPDATE inventory_items SET cost_per_unit = 8.70,    bom_category = 'paste', functionality = 'performance_additive' WHERE id = '6dd94e6e-13ef-4ba7-a0b9-cd793c99a34a'; -- PEG 600

-- Separator step (Chaoli, Cellophane, Kapton)
UPDATE inventory_items SET cost_per_unit = 0.6935, bom_category = 'separator'                                       WHERE id = '1b6348dc-fa3c-4e6d-918b-7c6a0a4e89f7'; -- Chaoli_140
UPDATE inventory_items SET cost_per_unit = 0.2296, bom_category = 'separator', unit = 'm'                           WHERE id = '3f2509a9-8476-4f9c-9fef-519beca8c99b'; -- Separator Cellophane (LM→m, qty=0)
UPDATE inventory_items SET cost_per_unit = 0.5938, bom_category = 'separator', unit = 'm', type='tape', process_step='winding', functionality='structural'
                                                                                                                     WHERE id = '69521232-aba0-424d-ac6e-d64b6be0f57a'; -- Tape Kapton Film (LM→m, qty=0)

-- Mesh (Folded Edge variants — keep BOM cost NULL since obsolete; just normalize unit + identifiers)
UPDATE inventory_items SET bom_category = 'mesh', unit = 'm', type='mesh', process_step='electrode', functionality='current_collector'
                                                                                                                     WHERE id = '7eb44780-ea17-495e-ae55-e3c3b274c3ae'; -- Folded edge Copper Mesh (LM→m, qty=0)
UPDATE inventory_items SET bom_category = 'mesh', unit = 'm', type='mesh', process_step='electrode', functionality='current_collector'
                                                                                                                     WHERE id = '6b6e4454-4211-4a2d-bec4-9bd5fccf12e5'; -- Folded edge Nickel Mesh (LM→m, qty=0)

-- Tabs / Electrode step (Patco)
UPDATE inventory_items SET cost_per_unit = 0.009167, bom_category = 'tabs', unit = 'in', type='tape', process_step='electrode', functionality='structural'
                                                                                                                     WHERE id = 'b9ede981-ac8a-4abd-b547-3f7ba0f0fab0'; -- Patco 5560 Tape (LM→in, qty=0)

-- Housing — Cell Terminal O-ring + Epoxy Totalboat
UPDATE inventory_items SET cost_per_unit = 0.04, bom_category = 'housing'                                            WHERE id = 'c97dfe6b-aacd-4d50-afff-7703afb9d1e4'; -- Cell Terminal O-ring
UPDATE inventory_items SET cost_per_unit = 27.00, bom_category = 'housing', unit = 'L', type='epoxy', process_step='cell_assembly', functionality='sealant'
                                                                                                                     WHERE id = '5896530b-5c2c-4686-8be2-96a8bfc0acbf'; -- Epoxy Totalboat (kg→L, qty=0)

-- Electrolyte step
UPDATE inventory_items SET cost_per_unit = 4.823, bom_category = 'electrolyte'                                       WHERE id = '25b2ad36-7b28-4ad8-a246-66924f69745a'; -- Electrolyte 25% KOH ($/L, density 1.24)
UPDATE inventory_items SET cost_per_unit = 0.31,  bom_category = 'electrolyte'                                       WHERE id = '68ad7d50-3531-451b-95f7-941299881c42'; -- G&B Vent Caps

-- =========================================================================
-- 6. INSERT new BOM-only inventory items
--    Items with no clear single match in current inventory get inserted with
--    the BOM exact name. Manual cleanup later via Update Inventory Item form.
-- =========================================================================

-- Paste — Acetylene Black (not yet in inventory) and Zirconia (existing "Zirconium Oxide" stays as-is)
INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Acetylene Black', 'raw_chemical', 'kg', 0.00, 'raw_chemical', 'paste', 'conductor', 'paste',
       'BOM ref: qty 0/cell. Inserted by 009 phase1.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Acetylene Black'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Zirconia (ZrO2)', 'raw_chemical', 'kg', 40.00, 'raw_chemical', 'paste', 'performance_additive', 'paste',
       'BOM ref: 0.016 kg/cell @ $0.64. Existing "Zirconium Oxide" item is the same chemical — manually merge if desired.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) IN (LOWER('Zirconia (ZrO2)'), LOWER('Zirconia (ZrO₂)')));

-- Mesh variants
INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, type, process_step, functionality, bom_category, notes)
SELECT 'Nickel Mesh 6" (220 Ah)', 'collector', 'm', 2.9406, 0.16, 152.4, 'mesh', 'electrode', 'current_collector', 'mesh',
       'BOM ref: 2 m/cell @ $5.88. Cathode mesh, 6" width.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Nickel Mesh 6" (220 Ah)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, type, process_step, functionality, bom_category, notes)
SELECT 'Copper Mesh 6" (220 Ah)', 'collector', 'm', 1.4742, 0.149, 152.4, 'mesh', 'electrode', 'current_collector', 'mesh',
       'BOM ref: 2 m/cell @ $2.95. Anode mesh, 6" width.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Copper Mesh 6" (220 Ah)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Thick CRS Mesh (Prismatic)', 'collector', 'm', NULL, 'mesh', 'electrode', 'current_collector', 'mesh',
       'Prismatic format — qty 0 in Gen2 cylindrical.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Thick CRS Mesh (Prismatic)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Thick Copper Mesh (Prismatic)', 'collector', 'm', NULL, 'mesh', 'electrode', 'current_collector', 'mesh',
       'Prismatic format — qty 0 in Gen2 cylindrical.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Thick Copper Mesh (Prismatic)'));

-- Tabs
INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'L-Shaped Copper Tabs', 'tab', 'pcs', 0.00, 'tab', 'electrode', 'electrical_connection', 'tabs',
       'BOM ref: qty 0 in Gen2.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('L-Shaped Copper Tabs'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'L-Shaped Ni-plated CRS Tabs', 'tab', 'pcs', 0.00, 'tab', 'electrode', 'electrical_connection', 'tabs',
       'BOM ref: qty 0 in Gen2.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('L-Shaped Ni-plated CRS Tabs'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Nickel Tab 0.005" (Dead Soft)', 'tab', 'ft', 0.19, 'tab', 'electrode', 'electrical_connection', 'tabs',
       'BOM ref: 2 ft/cell @ $0.38. Existing "Nickel Tab .005" rows (currently miscategorized as collector) are similar — manually merge or delete the duplicates.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Nickel Tab 0.005" (Dead Soft)'));

-- Housing
INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Cylindrical Cell Lids', 'packaging', 'pcs', 0.32, 'lid', 'cell_assembly', 'structural', 'housing',
       'BOM ref: 1 lid/cell. Existing "Cylindrical Cell lids rev 3/4", "Cylindrical Cell Lids rev 5", and "Godrej Cell lids rev 3/4" are revision-specific variants — manually consolidate as needed.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cylindrical Cell Lids'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Cylindrical Cell Can (Rev 3)', 'packaging', 'pcs', 2.39, 'can', 'cell_assembly', 'structural', 'housing',
       'BOM ref: 1 can/cell. Existing "Cylindrical Cell Cans rev 3/4" (qty 2162) is likely the same — manually consolidate.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cylindrical Cell Can (Rev 3)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Cell Terminals', 'packaging', 'pcs', 0.36, 'terminal', 'cell_assembly', 'electrical_connection', 'housing',
       'BOM ref: 2 terminals/cell @ $0.72 total. Existing "Cell Terminal RevD" is a rev-specific variant — manually consolidate.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cell Terminals'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Devcon Epoxy (O-rings)', 'raw_chemical', 'ml', 0.7000, 'epoxy', 'cell_assembly', 'sealant', 'housing',
       'BOM ref: 0.667 ml/cell @ $0.47.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Devcon Epoxy (O-rings)'));

INSERT INTO inventory_items (name, category, unit, cost_per_unit, type, process_step, functionality, bom_category, notes)
SELECT 'Cell Labels (corrosion resistant)', 'packaging', 'pcs', 0.05, 'label', 'cell_assembly', 'label', 'housing',
       'BOM ref: 1 label/cell. Existing "Cell Can Labels" is similar — manually consolidate.'
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER('Cell Labels (corrosion resistant)'));

-- =========================================================================
-- 7. Migrate every existing inventory item with qty > 0 into a "legacy" lot
--    so the new lots-driven quantity model works from day one.
-- =========================================================================
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

COMMIT;

-- ============================================================================
-- VERIFICATION — run these AFTER the COMMIT to confirm everything's good.
-- All read-only.
-- ============================================================================

-- A. New columns are in place
SELECT column_name FROM information_schema.columns
WHERE table_name = 'inventory_items'
  AND column_name IN ('cost_per_unit_gigascale','bom_category','type','process_step','functionality','lead_time_days')
ORDER BY column_name;
-- Expected: 6 rows.

-- B. Lots table exists and got the legacy migration
SELECT count(*) AS total_lots,
       count(*) FILTER (WHERE lot_number = 'unspecified') AS unspecified_lots
FROM inventory_lots;
-- Expected: total_lots = number of items with quantity > 0 from snapshot (~33 rows).

-- C. Quantity reconciliation: inventory_items.quantity == SUM(lots.qty_remaining)
SELECT i.name, i.quantity AS item_qty,
       COALESCE(SUM(l.qty_remaining), 0) AS lot_total,
       i.quantity - COALESCE(SUM(l.qty_remaining), 0) AS delta
FROM inventory_items i
LEFT JOIN inventory_lots l ON l.inventory_item_id = i.id
GROUP BY i.id, i.name, i.quantity
HAVING ABS(i.quantity - COALESCE(SUM(l.qty_remaining), 0)) > 0.0001
ORDER BY i.name;
-- Expected: ZERO ROWS.

-- D. BOM coverage: every BOM line has cost_per_unit and bom_category set
SELECT bom_category,
       COUNT(*) AS n_items,
       COUNT(*) FILTER (WHERE cost_per_unit IS NULL) AS missing_cost,
       COUNT(*) FILTER (WHERE quantity > 0) AS in_stock
FROM inventory_items
WHERE bom_category IS NOT NULL
GROUP BY bom_category
ORDER BY bom_category;
-- Expected:
--   paste:        14 rows  (13 existing + Acetylene Black) — all with cost (Acetylene Black is $0)
--   mesh:         6+ rows  (2 existing folded-edge, 4 new variants) — some NULL cost (obsolete)
--   tabs:         5  rows  (Patco + 3 new + Nickel Tab dead soft)
--   separator:    3  rows  (Chaoli, Cellophane, Kapton)
--   housing:      ~7 rows
--   electrolyte:  2  rows  (KOH + Vent Caps)

-- E. Identifier coverage — every item has type / process_step / functionality
SELECT
  COUNT(*) AS total_items,
  COUNT(*) FILTER (WHERE type IS NULL)          AS missing_type,
  COUNT(*) FILTER (WHERE process_step IS NULL)  AS missing_process,
  COUNT(*) FILTER (WHERE functionality IS NULL) AS missing_functionality
FROM inventory_items;
-- Expected: missing_type=0, missing_process=0, missing_functionality may be > 0 for finished_good/other.

-- F. Sanity check on packaging split
SELECT type, COUNT(*) AS n, SUM(CASE WHEN process_step = 'cell_assembly' THEN 1 ELSE 0 END) AS cell_step,
       SUM(CASE WHEN process_step = 'module_assembly' THEN 1 ELSE 0 END) AS module_step
FROM inventory_items
WHERE category = 'packaging'
GROUP BY type
ORDER BY n DESC;
-- Inspect: cans/lids/terminals/o_rings/labels/vent_cap should be cell_assembly;
--          busbar/fastener/module_terminal/module_box/module_handle/sleeve should be module_assembly.
