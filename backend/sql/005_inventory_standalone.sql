-- 005: Revise inventory to be standalone (not dependent on materials table)
-- Supports the full Excel inventory: raw chemicals, separators, collectors,
-- electrolyte, finished goods, packaging, electronics, etc.

-- Drop old tables if they exist (they haven't been deployed yet)
DROP TABLE IF EXISTS design_bom CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;

-- Standalone inventory catalog — every trackable item gets a row
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,          -- 'raw_chemical', 'separator', 'collector', 'electrolyte', 'finished_good', 'packaging', 'electronics', 'other'
    unit VARCHAR(30) NOT NULL,              -- 'kg', 'lbs', 'ft', 'm', 'L', 'pcs', 'rolls'
    package_unit VARCHAR(50),               -- 'bag', 'supersack', 'roll', 'drum', 'tote', 'jar', 'bottle', 'box'
    package_size FLOAT,                     -- qty per package (e.g. 50 lbs/bag)
    quantity FLOAT NOT NULL DEFAULT 0,      -- current stock in 'unit'
    lot_number VARCHAR(100),
    location VARCHAR(100),                  -- 'warehouse', 'production', 'lab'
    reorder_point FLOAT,                    -- alert when qty drops below this
    material_id UUID REFERENCES materials(id) ON DELETE SET NULL,   -- optional link to design material
    chemical_id UUID REFERENCES chemicals(id) ON DELETE SET NULL,   -- optional link to chemical
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_items_category ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inv_items_name ON inventory_items(name);

-- Inventory transactions: append-only ledger
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    qty_change FLOAT NOT NULL,              -- positive = received, negative = consumed
    reason VARCHAR(50) NOT NULL,            -- 'received', 'production', 'scrap', 'adjustment', 'count', 'return'
    batch_id VARCHAR(100),                  -- reference to FileMaker batch
    design_id UUID REFERENCES designs(id) ON DELETE SET NULL,
    performed_by VARCHAR(100),              -- who did this
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_item ON inventory_transactions(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_batch ON inventory_transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_created ON inventory_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_txn_reason ON inventory_transactions(reason);

-- Design BOM: bill of materials per design
CREATE TABLE IF NOT EXISTS design_bom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL, -- link to inventory for consumption
    material_id UUID REFERENCES materials(id) ON DELETE SET NULL,             -- link to design material
    layer_name VARCHAR(255),
    role VARCHAR(50),                       -- 'cathode', 'anode', 'separator', 'electrolyte', 'can', 'tab'
    qty_per_cell FLOAT NOT NULL,
    unit VARCHAR(30) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bom_design ON design_bom(design_id);
CREATE INDEX IF NOT EXISTS idx_bom_inv_item ON design_bom(inventory_item_id);

-- Seed initial inventory from Excel sheet categories
-- (Run this after creating the tables to populate the catalog)
