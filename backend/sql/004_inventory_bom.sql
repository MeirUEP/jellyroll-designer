-- Inventory & BOM tables
-- Run against the jellyroll database to add inventory tracking and BOM support.

-- Inventory items: current stock per material/lot
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    quantity FLOAT NOT NULL,
    unit VARCHAR(30) NOT NULL,          -- 'linear_ft', 'kg', 'sheets', 'rolls', 'each'
    lot_number VARCHAR(100),
    location VARCHAR(100),              -- 'warehouse', 'line-1'
    expiry_date TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_material ON inventory_items(material_id);

-- Inventory transactions: append-only ledger of every change
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    qty_change FLOAT NOT NULL,          -- positive = received, negative = consumed
    reason VARCHAR(50) NOT NULL,        -- 'received', 'production', 'scrap', 'adjustment', 'return'
    batch_id VARCHAR(100),              -- reference to FileMaker batch
    design_id UUID REFERENCES designs(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_item ON inventory_transactions(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_batch ON inventory_transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_created ON inventory_transactions(created_at);

-- Design BOM: bill of materials per design (auto-generated from simulation)
CREATE TABLE IF NOT EXISTS design_bom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    layer_name VARCHAR(255),
    role VARCHAR(50),                   -- 'cathode', 'anode', 'separator'
    qty_per_cell FLOAT NOT NULL,        -- quantity per cell in given unit
    unit VARCHAR(30) NOT NULL,          -- 'mm', 'each', 'cm2'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bom_design ON design_bom(design_id);
CREATE INDEX IF NOT EXISTS idx_bom_material ON design_bom(material_id);
