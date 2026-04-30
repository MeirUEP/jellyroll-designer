-- ============================================================================
-- 008_bom_match_preview.sql
-- READ-ONLY preview. Paste this into Redash BEFORE running 009_bom_and_lots_phase1.sql.
-- It reports which BOM components exactly-name-match an existing inventory_items
-- row and which don't, so the human can confirm matches look right.
--
-- A NULL inventory_id row means the BOM line has no exact name match in inventory.
-- Either the inventory item needs to be renamed to match the BOM, or this BOM line
-- will be inserted as a new inventory item by the migration script.
-- ============================================================================

WITH bom AS (
  -- (bom_name, bom_cost_per_unit, bom_category, unit, status)
  SELECT * FROM (VALUES
    -- Paste components (existing inventory expected for all 13)
    ('Zinc Powder',                     5.5584,  'paste',     'kg', 'IN PRODUCTION'),
    ('Graphite Imerys MX25',            12.28,   'paste',     'kg', 'IN PRODUCTION'),
    ('EMD',                             6.402,   'paste',     'kg', 'IN PRODUCTION'),
    ('Graphite Imerys BNB90',           18.60,   'paste',     'kg', 'IN PRODUCTION'),
    ('Bismuth Oxide (Bi2O3)',           38.00,   'paste',     'kg', 'IN PRODUCTION'),
    ('Calcium Hydroxide (Ca(OH)2)',     7.89,    'paste',     'kg', 'IN PRODUCTION'),
    ('Zinc Oxide (ZnO)',                3.92,    'paste',     'kg', 'IN PRODUCTION'),
    ('Acetylene Black',                 0.00,    'paste',     'kg', 'IN PRODUCTION'),
    ('Zirconia (ZrO2)',                 40.00,   'paste',     'kg', 'IN PRODUCTION'),
    ('Laponite',                        35.96,   'paste',     'kg', 'IN PRODUCTION'),
    ('Cathode PTFE',                    19.32,   'paste',     'kg', 'IN PRODUCTION'),
    ('Anode PTFE',                      19.32,   'paste',     'kg', 'IN PRODUCTION'),
    ('PEG 600',                         8.70,    'paste',     'kg', 'IN PRODUCTION'),
    -- Separator step (per BOM "4 - Jelly Roll")
    ('Chaoli-140',                      0.6935,  'separator', 'm',  'IN PRODUCTION'),
    ('Cellophane 7.0" 1-ply',           0.2296,  'separator', 'm',  'IN PRODUCTION'),
    ('Kapton Film Tape',                0.5938,  'separator', 'm',  'IN PRODUCTION'),
    -- Mesh ("2 - Strip")
    ('Nickel Mesh 6" (220 Ah)',         2.9406,  'mesh',      'm',  'IN PRODUCTION'),
    ('Copper Mesh 6" (220 Ah)',         1.4742,  'mesh',      'm',  'IN PRODUCTION'),
    ('Thick CRS Mesh (Prismatic)',      NULL,    'mesh',      'm',  'IN PRODUCTION'),
    ('Thick Copper Mesh (Prismatic)',   NULL,    'mesh',      'm',  'IN PRODUCTION'),
    ('Folded Edge Copper Mesh 5.6875"', NULL,    'mesh',      'm',  'OBSOLETE'),
    ('Folded Edge Nickel Mesh 6.4375"', NULL,    'mesh',      'm',  'OBSOLETE'),
    -- Tabs ("3 - Electrode")
    ('Patco 5560 Tape',                 0.009167,'tabs',      'in', 'IN PRODUCTION'),
    ('L-Shaped Copper Tabs',            0.00,    'tabs',      'pcs','IN PRODUCTION'),
    ('L-Shaped Ni-plated CRS Tabs',     0.00,    'tabs',      'pcs','IN PRODUCTION'),
    ('Nickel Tab 0.005" (Dead Soft)',   0.19,    'tabs',      'ft', 'IN PRODUCTION'),
    -- Housing ("5 - Dry Cell")
    ('Cylindrical Cell Lids',           0.32,    'housing',   'pcs','IN PRODUCTION'),
    ('Cell Terminal O-rings',           0.04,    'housing',   'pcs','IN PRODUCTION'),
    ('Cylindrical Cell Can (Rev 3)',    2.39,    'housing',   'pcs','IN PRODUCTION'),
    ('Cell Terminals',                  0.36,    'housing',   'pcs','IN PRODUCTION'),
    ('Epoxy (Totalboat)',               27.00,   'housing',   'L',  'IN PRODUCTION'),
    ('Devcon Epoxy (O-rings)',          0.7000,  'housing',   'ml', 'IN PRODUCTION'),
    ('Cell Labels (corrosion resistant)',0.05,   'housing',   'pcs','IN PRODUCTION'),
    -- Electrolyte ("6 - Filled Cell")
    ('Electrolyte 25% KOH',             3.8892,  'electrolyte','kg', 'IN PRODUCTION'),
    ('G&B Vent Caps',                   0.31,    'electrolyte','pcs','IN PRODUCTION')
  ) AS t(bom_name, bom_cost_per_unit, bom_category, unit, status)
)
SELECT
  b.bom_name,
  b.unit                    AS bom_unit,
  b.bom_cost_per_unit       AS bom_cost,
  b.bom_category,
  b.status,
  i.id                      AS inventory_id,
  i.name                    AS inventory_name,
  i.unit                    AS inventory_unit,
  i.cost_per_unit           AS current_cost,
  i.category                AS current_category,
  CASE
    WHEN i.id IS NULL THEN 'WILL_INSERT_NEW'
    WHEN i.cost_per_unit IS NULL OR i.cost_per_unit = 0 THEN 'WILL_BACKFILL_COST'
    WHEN i.cost_per_unit != b.bom_cost_per_unit THEN 'WILL_OVERWRITE_COST'
    ELSE 'COST_ALREADY_MATCHES'
  END AS planned_action
FROM bom b
LEFT JOIN inventory_items i
  ON LOWER(TRIM(i.name)) = LOWER(TRIM(b.bom_name))
ORDER BY
  CASE WHEN i.id IS NULL THEN 0 ELSE 1 END,  -- new inserts first so they're easy to spot
  b.bom_category, b.bom_name;
