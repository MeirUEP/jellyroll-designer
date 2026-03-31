-- Migration: Normalized component schema (7 tables)
-- Run as: psql -U jellyroll -d jellyroll -f 002_normalized_schema.sql

BEGIN;

-- 1. Chemicals (raw materials with physical properties)
CREATE TABLE IF NOT EXISTS chemicals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    density FLOAT NOT NULL,
    capacity FLOAT NOT NULL DEFAULT 0,
    is_active_mat BOOLEAN NOT NULL DEFAULT false,
    category VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Materials (physical layer materials: separators, tapes, etc.)
CREATE TABLE IF NOT EXISTS materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL,
    thickness FLOAT NOT NULL,
    width FLOAT NOT NULL,
    color VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Mixes (formulation recipes referencing chemicals)
CREATE TABLE IF NOT EXISTS mixes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(20) NOT NULL,
    bulk_density FLOAT NOT NULL,
    mesh_density FLOAT NOT NULL DEFAULT 0,
    cc_material VARCHAR(100),
    components JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Layer stacks (ordered material arrangements)
CREATE TABLE IF NOT EXISTS layer_stacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Drop old designs table and recreate with FK references
DROP TABLE IF EXISTS simulation_results CASCADE;
DROP TABLE IF EXISTS capacity_results CASCADE;
DROP TABLE IF EXISTS designs CASCADE;

CREATE TABLE designs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(10) NOT NULL DEFAULT '1.2',
    cathode_mix_id UUID REFERENCES mixes(id),
    anode_mix_id UUID REFERENCES mixes(id),
    layer_stack_id UUID REFERENCES layer_stacks(id),
    cell_params JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_designs_created_at ON designs(created_at);
CREATE INDEX idx_designs_updated_at ON designs(updated_at);

-- 6. Simulation results
CREATE TABLE simulation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID NOT NULL UNIQUE REFERENCES designs(id) ON DELETE CASCADE,
    turns JSONB NOT NULL,
    c_tabs JSONB NOT NULL,
    a_tabs JSONB NOT NULL,
    outer_r FLOAT NOT NULL,
    min_pitch FLOAT NOT NULL,
    max_pitch FLOAT NOT NULL,
    cathode_len FLOAT,
    anode_len FLOAT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Capacity results
CREATE TABLE capacity_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id UUID NOT NULL UNIQUE REFERENCES designs(id) ON DELETE CASCADE,
    cath_cap_ah FLOAT NOT NULL,
    anod_cap_ah FLOAT NOT NULL,
    cell_cap_ah FLOAT NOT NULL,
    np_ratio FLOAT NOT NULL,
    cell_energy_1e FLOAT NOT NULL,
    total_dry_mass FLOAT NOT NULL,
    full_result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default chemicals
INSERT INTO chemicals (name, density, capacity, is_active_mat, category) VALUES
    ('EMD (MnO2)', 4.5, 250, true, 'active'),
    ('Graphite (MX-25)', 2.25, 0, false, 'conductor'),
    ('Carbon Black (BNB-90)', 1.8, 0, false, 'conductor'),
    ('PTFE', 2.15, 0, false, 'binder'),
    ('Bi2O3', 8.9, 0, false, 'additive'),
    ('ZrO2', 5.68, 0, false, 'additive'),
    ('Zinc (Zn)', 7.14, 820, true, 'active'),
    ('ZnO', 5.61, 660, true, 'active'),
    ('Ca(OH)2', 2.24, 0, false, 'additive'),
    ('Laponite', 2.53, 0, false, 'additive'),
    ('In(OH)3', 4.39, 0, false, 'additive')
ON CONFLICT (name) DO NOTHING;

-- Seed default materials
INSERT INTO materials (name, type, thickness, width, color) VALUES
    ('Kraft paper', 'separator', 0.15, 228, '#b45309'),
    ('Cellophane A', 'separator', 0.05, 226, '#38bdf8'),
    ('Cellophane B', 'separator', 0.05, 226, '#7dd3fc'),
    ('Cellophane C', 'separator', 0.05, 226, '#38bdf8'),
    ('Cellophane D', 'separator', 0.05, 226, '#7dd3fc'),
    ('Kraft paper 2', 'separator', 0.15, 228, '#d97706'),
    ('PVA lam.', 'separator', 0.10, 224, '#a855f7')
ON CONFLICT (name) DO NOTHING;

COMMIT;
