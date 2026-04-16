-- Seed inventory catalog from components.xlsx (UEP receiving QA spec sheet).
-- Run AFTER the supplier column is added:
--   ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier VARCHAR(255);
--
-- Idempotent: rows keyed off name; re-running inserts only what's missing.
-- Capacity is intentionally left NULL — will be filled in per design.
-- Quantity / cost_per_unit / reorder_point are left unset; operations team
-- will populate those via the Receive Shipment + Update Physical Count flows.
--
-- Density notes:
--   * Tap densities are flagged in the `notes` column (tap densities run
--     ~2-3x lower than true crystal density; the simulator wants bulk
--     density which is closer to tap for granular actives).
--   * Mesh areal densities (g/in^2) are kept in `notes` since the
--     inventory schema doesn't have a dedicated column for them —
--     electrode design tab still pulls mesh areal density from `elecProps`.
-- Dimensional conversions: 1 in = 25.4 mm.

INSERT INTO inventory_items (
    name, category, unit, supplier,
    density, is_active_mat,
    thickness_mm, width_mm,
    notes
)
SELECT v.* FROM (VALUES
    -- ==================== RAW CHEMICALS (Cathode + Anode coating) ====================
    ('EMD',                            'raw_chemical', 'kg', 'Vibrantz Technologies',
        2.5::float, true,
        NULL::float, NULL::float,
        'Tap density 2.5 +/- 0.15 g/mL (true crystal ~4.4 g/cm^3). Active cathode material. PSD: >75um 15-30%, >45um 45-55%, <45um 10-35%. XRD peaks must match reference.'::text),
    ('Graphite Imerys BNB90',          'raw_chemical', 'kg', 'Imerys',
        0.1, false, NULL, NULL,
        'Tap density 0.1 +/- 0.02 g/mL. Cathode conductor. XRD peaks must match reference.'),
    ('Graphite Imerys MX25',           'raw_chemical', 'kg', 'Imerys',
        0.25, false, NULL, NULL,
        'Tap density 0.25 +/- 0.02 g/mL. Cathode conductor. XRD peaks must match reference.'),
    ('Graphite Superior AGB1045',      'raw_chemical', 'kg', 'Superior Graphite',
        0.1, false, NULL, NULL,
        'Tap density 0.1 +/- 0.02 g/mL. Cathode conductor. XRD peaks must match reference.'),
    ('Graphite Superior 2939APH',      'raw_chemical', 'kg', 'Superior Graphite',
        0.27, false, NULL, NULL,
        'Tap density 0.27 +/- 0.02 g/mL. Cathode conductor. XRD peaks must match reference.'),
    ('Cathode PTFE',                   'raw_chemical', 'kg', 'GFL Americas, LLC',
        1.51, false, NULL, NULL,
        'True density 1.51 +/- 0.1 g/mL. Cathode binder.'),
    ('Zinc Powder',                    'raw_chemical', 'kg', 'Everzinc',
        4.4, true, NULL, NULL,
        'Tap density 4.4 +/- 0.15 g/mL (true crystal ~7.14 g/cm^3). Active anode material. PSD: >425um <1%, <75um 50-100%, <45um 0-26%. XRD peaks must match reference.'),
    ('Indium Hydroxide',               'raw_chemical', 'kg', 'G&B',
        4.3, false, NULL, NULL,
        'Tap density 4.3 +/- 0.15 g/mL. Anode additive (corrosion inhibitor). PSD d10/d50/d90 spec. XRD peaks must match reference.'),
    ('Laponite',                       'raw_chemical', 'kg', 'BYK (Terra Firma)',
        1.0, false, NULL, NULL,
        'Tap density 1.0 +/- 0.1 g/mL. Anode rheology modifier. Moisture max 10%. XRD peaks must match reference.'),
    ('PEG 600',                        'raw_chemical', 'kg', 'G&B',
        1.13, false, NULL, NULL,
        'True density 1.13 +/- 0.01 g/mL. Anode additive.'),
    ('Anode PTFE',                     'raw_chemical', 'kg', 'GFL Americas, LLC',
        1.51, false, NULL, NULL,
        'True density 1.51 +/- 0.1 g/mL. Anode binder.'),
    ('Zinc Oxide',                     'raw_chemical', 'kg', 'US Zinc',
        0.75, true, NULL, NULL,
        'Tap density 0.75 +/- 0.03 g/mL (true crystal ~5.61 g/cm^3). Active anode material (discharged state). XRD peaks must match reference.'),

    -- ==================== CURRENT COLLECTORS (Mesh) ====================
    ('Folded edge Nickel Mesh',        'collector', 'LM', 'Baoji Yunjie Metal',
        NULL, false,
        0.3048, 163.5125,
        'Width 6.4375 +/- 0.0625 in (163.51 mm). Thickness 0.012 +/- 0.001 in (0.305 mm). Areal density 0.160 +/- 0.05 g/in^2 (cathode current collector).'),
    ('Folded edge Copper Mesh',        'collector', 'LM', 'Hubei Kunzhan Electronic Technology Co., LTD.',
        NULL, false,
        0.2794, 144.4625,
        'Width 5.6875 +/- 0.0625 in (144.46 mm). Thickness 0.011 +/- 0.001 in (0.279 mm). Areal density 0.149 +/- 0.05 g/in^2 (anode current collector).'),

    -- ==================== TABS ====================
    ('Fully Annealed Nickel Tab 0.005"', 'tab', 'pcs', 'Baoji Yunjie Metal',
        NULL, false,
        0.127, 12.7,
        'Width 0.5 +/- 0.005 in (12.7 mm). Thickness 0.005 +/- 0.0001 in (0.127 mm). Fully annealed.'),

    -- ==================== TAPES ====================
    ('Patco 5560 Tape',                'tape', 'LM', 'FindTape.com',
        NULL, false,
        0.1397, NULL,
        'Thickness 0.0055 +/- 0.0005 in (0.140 mm). Electrode edge tape.'),
    ('Tape Kapton Film',               'tape', 'LM', 'FindTape.com',
        NULL, false,
        0.0635, NULL,
        'Thickness 0.0025 +/- 0.0005 in (0.0635 mm). Used during winding.'),

    -- ==================== SEPARATORS ====================
    ('Kraft Brown Paper',              'separator', 'LM', 'G&B',
        NULL, false,
        0.127, 158.75,
        'Width 6.25 +/- 0.0625 in (158.75 mm). Thickness 0.005 +/- 0.001 in (0.127 mm).'),
    ('Separator Cellophane 7.0" 1-ply','separator', 'LM', 'Futamura',
        NULL, false,
        0.0254, 177.8,
        'Width 7.0 +/- 0.0625 in (177.80 mm). Thickness 0.001 +/- 0.0005 in (0.0254 mm). Single ply.'),
    ('Embossed CWPVA',                 'separator', 'LM', 'G&B',
        NULL, false,
        0.0762, 187.96,
        'Width 7.4 +/- 0.12 in (187.96 mm). Thickness 0.003 +/- 0.0005 in (0.0762 mm). Embossed cellophane / PVA laminate.'),

    -- ==================== ELECTROLYTE ====================
    ('Electrolyte 25% KOH',            'electrolyte', 'L', 'Brenntag',
        1.23, false, NULL, NULL,
        'Density 1.23 +/- 0.01 g/mL. 25 wt% KOH aqueous.'),
    ('Electrolyte 30% KOH',            'electrolyte', 'L', 'Brenntag',
        1.28, false, NULL, NULL,
        'Density 1.28 +/- 0.01 g/mL. 30 wt% KOH aqueous.'),

    -- ==================== CELL ASSEMBLY (packaging) ====================
    ('Cell Terminal RevD',             'packaging', 'pcs', 'Engitech Industries',
        NULL, false, NULL, NULL,
        'Min 5 micron plating. No thread corrosion. Height 0.525 +/- 0.005 in (dictates interior lid height — tight positive tolerance only).'),
    ('Cell Terminal O-ring',           'packaging', 'pcs', 'Apple rubber',
        NULL, false, NULL, NULL,
        'Regulated. No material shredding.'),
    ('CC5 Cell Lid',                   'packaging', 'pcs', 'G&B',
        NULL, false, NULL, NULL,
        'No cracks / chips / degradation.'),
    ('CC5 Cell Can',                   'packaging', 'pcs', 'G&B',
        NULL, false, NULL, NULL,
        'Inner dia 3.95 +/- 0.001 in. Outer dia 4.1 +/- 0.001 in. No cracks / chips / degradation.'),
    ('Epoxy Totalboat',                'other',     'kg', 'Jamestown Distributors',
        1.15, false, NULL, NULL,
        'Resin density 1.15 +/- 0.01 g/mL. Hardener density 0.95 +/- 0.01 g/mL.'),
    ('Cell Can Labels',                'packaging', 'pcs', 'onlinelabels.com',
        NULL, false, NULL, NULL,
        'Intact and free of tears.'),
    ('PVC Sleeve',                     'packaging', 'LM', 'perigreedirect.com',
        NULL, false,
        1.9812, 149.86,
        'Width 5.9 +/- 0.02 in (149.86 mm). Thickness 0.078 +/- 0.008 in (1.98 mm).'),
    ('Loctite EA E-90FL',              'other',     'kg', 'zoro.com',
        1.3, false, NULL, NULL,
        'Resin density 1.3 +/- 0.01 g/mL. Hardener density 1.1 +/- 0.01 g/mL.'),
    ('G&B Vent Caps',                  'packaging', 'pcs', 'G&B',
        NULL, false, NULL, NULL,
        'Upper part must not detach.'),

    -- ==================== MODULE ASSEMBLY ====================
    ('Battery Box Lid',                'packaging', 'pcs', 'G&B Supplier (Bhansali Engineering Polymers Ltd., India)',
        NULL, false, NULL, NULL,
        'No cracks / chips / degradation.'),
    ('Battery Box',                    'packaging', 'pcs', 'G&B Supplier (Bhansali Engineering Polymers Ltd., India)',
        NULL, false, NULL, NULL,
        'Check mold shrinkage. Sample fit: 10 cells + lid.'),
    ('Module Handles',                 'packaging', 'pcs', 'Dongguan Boke Precise Molding Technology Co., Ltd (China)',
        NULL, false, NULL, NULL,
        'Rope press-fit resistance check — too loose is an issue.'),
    ('Module Rope (for Handle)',       'packaging', 'pcs', 'Dongguan Boke Precise Molding Technology Co., Ltd (China)',
        NULL, false, NULL, NULL,
        'Rope press-fit resistance check — too loose is an issue.'),
    ('Module Label',                   'packaging', 'pcs', 'Sheetlabels.com',
        NULL, false, NULL, NULL,
        'No spelling mistakes.'),
    ('Module Screws Plastic Thread Forming', 'packaging', 'pcs', 'Fastener Superstore',
        NULL, false, NULL, NULL,
        'Length 5/8 in.'),
    ('Battery Terminal RevC Left',     'packaging', 'pcs', 'Engitech Industries',
        NULL, false, NULL, NULL,
        'Min 7 micron plating. No corrosion. Screw holes deburred.'),
    ('Battery Terminal RevC Right',    'packaging', 'pcs', 'Engitech Industries',
        NULL, false, NULL, NULL,
        'Min 7 micron plating. No corrosion. Screw holes deburred.'),
    ('Busbar BB10S_L101.7',            'packaging', 'pcs', 'Pinsheng',
        NULL, false, NULL, NULL,
        'Min 13.5 micron plating. No corrosion. Screw holes deburred.'),
    ('Busbar BB10S_L127.41',           'packaging', 'pcs', 'Pinsheng',
        NULL, false, NULL, NULL,
        'Min 13.5 micron plating. No corrosion. Screw holes deburred.'),
    ('Busbar BB10S_L62.158',           'packaging', 'pcs', 'Pinsheng',
        NULL, false, NULL, NULL,
        'Min 13.5 micron plating. No corrosion. Screw holes deburred.'),
    ('Busbar to Cell Screws Hex Head Serrated Flange M6 16mm', 'packaging', 'pcs', 'Bolt Depot',
        NULL, false, NULL, NULL,
        'Regulated. No material shredding or corrosion.'),
    ('PCB 10S',                        'electronics', 'pcs', 'Pinsheng',
        NULL, false, NULL, NULL,
        'Verify solder points / traces intact. Use BMS to cross-check cell OCV consistency.'),
    ('Hex Head Tap Bolt M6 12mm',      'packaging', 'pcs', 'Bolt Depot',
        NULL, false, NULL, NULL,
        'Regulated. No material shredding or corrosion.'),
    ('Flat Washers M6',                'packaging', 'pcs', 'Fastener Superstore',
        NULL, false, NULL, NULL,
        'Regulated. No material shredding or corrosion.')
) AS v(name, category, unit, supplier, density, is_active_mat, thickness_mm, width_mm, notes)
WHERE NOT EXISTS (
    SELECT 1 FROM inventory_items i WHERE i.name = v.name
);

-- If you want to backfill supplier values into rows that were previously
-- inserted WITHOUT supplier (e.g. from the older 006 seed), uncomment
-- and run the block below. Names below MUST match your existing rows.
--
-- UPDATE inventory_items SET supplier = 'Vibrantz Technologies' WHERE name = 'EMD' AND supplier IS NULL;
-- UPDATE inventory_items SET supplier = 'Everzinc'              WHERE name = 'Zinc Powder' AND supplier IS NULL;
-- UPDATE inventory_items SET supplier = 'US Zinc'               WHERE name = 'Zinc Oxide' AND supplier IS NULL;
-- UPDATE inventory_items SET supplier = 'GFL Americas, LLC'     WHERE name = 'PTFE' AND supplier IS NULL;
-- UPDATE inventory_items SET supplier = 'G&B'                   WHERE name = 'PEG' AND supplier IS NULL;
-- UPDATE inventory_items SET supplier = 'G&B'                   WHERE name = 'Indium Hydroxide' AND supplier IS NULL;
-- UPDATE inventory_items SET supplier = 'BYK (Terra Firma)'     WHERE name = 'Laponite' AND supplier IS NULL;
