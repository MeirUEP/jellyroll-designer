-- ============================================================================
-- 008_bom_match_preview.sql  (v2)
-- READ-ONLY preview. Paste this into Redash BEFORE running 009.
-- v2 changes:
--   * Uses ILIKE prefix patterns instead of exact name matching, so items
--     with Unicode subscripts (Bi₂O₃, Ca(OH)₂, ZnO, ZrO₂) match correctly.
--   * Surfaces unit mismatches (BOM unit vs inventory unit) explicitly.
--   * Reports the planned new identifiers (type / process_step / functionality)
--     for each row so you can sanity-check the reclassification.
-- ============================================================================

WITH bom AS (
  SELECT * FROM (VALUES
    -- bom_name_pattern (ILIKE prefix), label, cost_per_unit, bom_unit, bom_category, type, process_step, functionality
    ('zinc powder%',                'Zinc Powder',                       5.5584,    'kg',  'paste',     'raw_chemical', 'paste',           'active_material'),
    ('graphite imerys mx25%',       'Graphite Imerys MX25',              12.28,     'kg',  'paste',     'raw_chemical', 'paste',           'conductor'),
    ('emd%',                        'EMD',                               6.402,     'kg',  'paste',     'raw_chemical', 'paste',           'active_material'),
    ('graphite imerys bnb90%',      'Graphite Imerys BNB90',             18.60,     'kg',  'paste',     'raw_chemical', 'paste',           'conductor'),
    ('bismuth oxide%',              'Bismuth Oxide (Bi₂O₃)',             38.00,     'kg',  'paste',     'raw_chemical', 'paste',           'performance_additive'),
    ('calcium hydroxide%',          'Calcium Hydroxide (Ca(OH)₂)',       7.89,      'kg',  'paste',     'raw_chemical', 'paste',           'performance_additive'),
    ('zinc oxide%',                 'Zinc Oxide (ZnO)',                  3.92,      'kg',  'paste',     'raw_chemical', 'paste',           'performance_additive'),
    ('acetylene black%',            'Acetylene Black',                   0.00,      'kg',  'paste',     'raw_chemical', 'paste',           'conductor'),
    ('zirconia%',                   'Zirconia (ZrO₂)',                   40.00,     'kg',  'paste',     'raw_chemical', 'paste',           'performance_additive'),
    ('laponite%',                   'Laponite',                          35.96,     'kg',  'paste',     'raw_chemical', 'paste',           'performance_additive'),
    ('cathode ptfe%',               'Cathode PTFE',                      19.32,     'kg',  'paste',     'raw_chemical', 'paste',           'binder'),
    ('anode ptfe%',                 'Anode PTFE',                        19.32,     'kg',  'paste',     'raw_chemical', 'paste',           'binder'),
    ('peg 600%',                    'PEG 600',                           8.70,      'kg',  'paste',     'raw_chemical', 'paste',           'performance_additive'),
    ('chaoli%',                     'Chaoli-140',                        0.6935,    'm',   'separator', 'separator',    'winding',         'separator'),
    ('cellophane%',                 'Cellophane 7.0" 1-ply',             0.2296,    'm',   'separator', 'separator',    'winding',         'separator'),
    ('kapton%',                     'Kapton Film Tape',                  0.5938,    'm',   'separator', 'tape',         'winding',         'structural'),
    ('nickel mesh 6%',              'Nickel Mesh 6" (220 Ah)',           2.9406,    'm',   'mesh',      'mesh',         'electrode',       'current_collector'),
    ('copper mesh 6%',              'Copper Mesh 6" (220 Ah)',           1.4742,    'm',   'mesh',      'mesh',         'electrode',       'current_collector'),
    ('thick crs mesh%',             'Thick CRS Mesh (Prismatic)',        NULL,      'm',   'mesh',      'mesh',         'electrode',       'current_collector'),
    ('thick copper mesh%',          'Thick Copper Mesh (Prismatic)',     NULL,      'm',   'mesh',      'mesh',         'electrode',       'current_collector'),
    ('folded edge copper mesh%',    'Folded Edge Copper Mesh 5.6875"',   NULL,      'm',   'mesh',      'mesh',         'electrode',       'current_collector'),
    ('folded edge nickel mesh%',    'Folded Edge Nickel Mesh 6.4375"',   NULL,      'm',   'mesh',      'mesh',         'electrode',       'current_collector'),
    ('patco%',                      'Patco 5560 Tape',                   0.009167,  'in',  'tabs',      'tape',         'electrode',       'structural'),
    ('l-shaped copper tabs%',       'L-Shaped Copper Tabs',              0.00,      'pcs', 'tabs',      'tab',          'electrode',       'electrical_connection'),
    ('l-shaped ni-plated%',         'L-Shaped Ni-plated CRS Tabs',       0.00,      'pcs', 'tabs',      'tab',          'electrode',       'electrical_connection'),
    ('nickel tab%',                 'Nickel Tab 0.005" (Dead Soft)',     0.19,      'ft',  'tabs',      'tab',          'electrode',       'electrical_connection'),
    ('cylindrical cell lid%',       'Cylindrical Cell Lids',             0.32,      'pcs', 'housing',   'lid',          'cell_assembly',   'structural'),
    ('cell terminal o-ring%',       'Cell Terminal O-rings',             0.04,      'pcs', 'housing',   'o_ring',       'cell_assembly',   'sealant'),
    ('cylindrical cell can%',       'Cylindrical Cell Can (Rev 3)',      2.39,      'pcs', 'housing',   'can',          'cell_assembly',   'structural'),
    ('cell terminals%',             'Cell Terminals',                    0.36,      'pcs', 'housing',   'terminal',     'cell_assembly',   'electrical_connection'),
    ('epoxy (totalboat)%',          'Epoxy (Totalboat)',                 27.00,     'L',   'housing',   'epoxy',        'cell_assembly',   'sealant'),
    ('devcon epoxy%',               'Devcon Epoxy (O-rings)',            0.7000,    'ml',  'housing',   'epoxy',        'cell_assembly',   'sealant'),
    ('cell labels%',                'Cell Labels (corrosion resistant)', 0.05,      'pcs', 'housing',   'label',        'cell_assembly',   'label'),
    ('electrolyte 25%',             'Electrolyte 25% KOH',               3.8892,    'kg',  'electrolyte','electrolyte', 'cell_assembly',   'active_material'),
    ('g&b vent caps%',              'G&B Vent Caps',                     0.31,      'pcs', 'electrolyte','vent_cap',    'cell_assembly',   'sealant')
  ) AS t(bom_pattern, bom_label, bom_cost_per_unit, bom_unit, bom_category, planned_type, planned_process, planned_functionality)
)
SELECT
  b.bom_label,
  b.bom_unit,
  b.bom_cost_per_unit AS bom_cost,
  b.bom_category,
  i.id                AS inventory_id,
  i.name              AS inventory_name,
  i.unit              AS inventory_unit,
  i.cost_per_unit     AS current_cost,
  i.category          AS current_category,
  b.planned_type,
  b.planned_process,
  b.planned_functionality,
  CASE
    WHEN i.id IS NULL THEN 'WILL_INSERT_NEW'
    WHEN i.unit IS DISTINCT FROM b.bom_unit AND i.quantity > 0 THEN 'UNIT_MISMATCH_HAS_STOCK'
    WHEN i.unit IS DISTINCT FROM b.bom_unit THEN 'UNIT_WILL_BE_UPDATED'
    WHEN i.cost_per_unit IS NULL OR i.cost_per_unit = 0 THEN 'WILL_BACKFILL_COST'
    WHEN ABS(i.cost_per_unit - b.bom_cost_per_unit) > 0.0001 THEN 'WILL_OVERWRITE_COST'
    ELSE 'COST_ALREADY_MATCHES'
  END AS planned_action,
  CASE WHEN i.id IS NULL THEN NULL ELSE i.quantity END AS current_qty
FROM bom b
LEFT JOIN inventory_items i
  ON LOWER(i.name) ILIKE b.bom_pattern
ORDER BY
  CASE
    WHEN i.id IS NULL THEN 0                              -- new inserts first
    WHEN i.unit IS DISTINCT FROM b.bom_unit AND i.quantity > 0 THEN 1  -- unit mismatches with stock (review!)
    WHEN i.unit IS DISTINCT FROM b.bom_unit THEN 2        -- unit changes (safe)
    ELSE 3                                                -- normal backfills last
  END,
  b.bom_category, b.bom_label;
