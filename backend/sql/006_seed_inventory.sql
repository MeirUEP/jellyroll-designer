-- Seed inventory catalog from UEP Physical Inventory Count Sheet
-- Run AFTER 005_inventory_standalone.sql

-- ==================== RAW CHEMICALS ====================
INSERT INTO inventory_items (name, category, unit, package_unit, package_size, quantity, location) VALUES
('EMD', 'raw_chemical', 'lbs', 'bag', 50, 0, 'warehouse'),
('Timcal Graphite C45', 'raw_chemical', 'kg', 'bag', 25, 0, 'warehouse'),
('Asbury Graphite 3160', 'raw_chemical', 'kg', 'bag', 22.68, 0, 'warehouse'),
('Zinc Powder', 'raw_chemical', 'lbs', 'supersack', NULL, 0, 'warehouse'),
('Zinc Oxide', 'raw_chemical', 'lbs', 'bag', 50, 0, 'warehouse'),
('PTFE', 'raw_chemical', 'kg', 'jar', NULL, 0, 'warehouse'),
('PEG', 'raw_chemical', 'kg', 'bottle', NULL, 0, 'warehouse'),
('Indium Hydroxide', 'raw_chemical', 'kg', 'jar', NULL, 0, 'warehouse'),
('Laponite', 'raw_chemical', 'kg', 'bag', NULL, 0, 'warehouse'),
('Bi2O3', 'raw_chemical', 'kg', 'jar', NULL, 0, 'warehouse');

-- ==================== SEPARATORS ====================
INSERT INTO inventory_items (name, category, unit, package_unit, quantity, location) VALUES
('Cellophane 325P', 'separator', 'ft', 'roll', 0, 'warehouse'),
('Hot PVA', 'separator', 'm', 'roll', 0, 'warehouse');

-- ==================== CURRENT COLLECTORS ====================
INSERT INTO inventory_items (name, category, unit, package_unit, quantity, location) VALUES
('Copper Mesh', 'collector', 'ft', 'roll', 0, 'warehouse'),
('Nickel Mesh (folded)', 'collector', 'ft', 'roll', 0, 'warehouse'),
('Nickel Mesh (unfolded)', 'collector', 'ft', 'roll', 0, 'warehouse'),
('Nickel Tabs', 'collector', 'pcs', NULL, 0, 'warehouse');

-- ==================== ELECTROLYTE ====================
INSERT INTO inventory_items (name, category, unit, package_unit, quantity, location) VALUES
('KOH 25%', 'electrolyte', 'L', 'drum', 0, 'warehouse'),
('KOH 30%', 'electrolyte', 'L', 'tote', 0, 'warehouse');

-- ==================== FINISHED GOODS ====================
INSERT INTO inventory_items (name, category, unit, package_unit, quantity, location) VALUES
('Cells (finished)', 'finished_good', 'pcs', NULL, 0, 'production'),
('Modules (assembled)', 'finished_good', 'pcs', NULL, 0, 'production');

-- ==================== PACKAGING ====================
INSERT INTO inventory_items (name, category, unit, package_unit, quantity, location) VALUES
('Cans', 'packaging', 'pcs', 'box', NULL, 0, 'warehouse'),
('Lids', 'packaging', 'pcs', 'box', NULL, 0, 'warehouse'),
('Shipping Boxes', 'packaging', 'pcs', NULL, 0, 'warehouse');

-- ==================== ELECTRONICS ====================
INSERT INTO inventory_items (name, category, unit, package_unit, quantity, location) VALUES
('PCBs', 'electronics', 'pcs', NULL, 0, 'warehouse');
