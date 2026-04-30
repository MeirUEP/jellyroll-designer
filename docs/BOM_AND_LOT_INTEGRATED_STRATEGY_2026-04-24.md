# Integrated Strategy — BOM + Lot-Based Inventory Management

**Date:** 2026-04-24
**Replaces / extends:** `BOM_INTEGRATION_STRATEGY_2026-04-24.md` (your annotated decisions are folded in here)
**Goal:** Single coherent data model that delivers BOM cost-per-cell + cost-per-kWh + category pie chart, while supporting lot-level traceability (Option C — opt-in per shipment), without breaking when lot data is partial or missing.

---

## 0. Your decisions (locked in)

From your annotations on the BOM strategy doc:

1. **Every BOM component becomes an inventory item.** No standalone `bom_components` table. (Big simplification — see §1.)
2. **Mesh variants:** every variant ("Nickel Mesh 6" 220 Ah", "Folded Edge Nickel 6.4375"", etc.) is its own inventory item.
3. **Present Volume / Gigascale toggle** in the BOM tab header.
4. **Nominal voltage** is a cell-params field, default `1.2 V`.
5. **Unit conversion happens at calculation time** — store BOM/inventory in their natural units.
6. **All BOM quantities are computed from the database** — design-driven for paste/mesh/separator/tabs, plus **new cell-params dropdowns** for fixed-overhead components (terminals, electrolyte, O-rings, vent caps, tape, lids, cans, labels) sourced from inventory.
7. **Compare-to-saved-design mode** is in scope from day one.
8. **Skip:** $/kWh-per-cycle, BOM-vs-actual cost variance views (for now).

From the lot-tracking discussion:

9. **Option C** — lot table + denormalized cache on inventory items. Lots are opt-in per shipment, system degrades gracefully if team doesn't enter lot numbers.

10. **Lots are inventory-only, not cost-tracking.** `inventory_items.cost_per_unit` is the single source of truth for cost — updated manually via the "Update inventory item" form whenever pricing changes. Lots track quantity-on-hand, supplier, and receive/expiration dates only. No per-lot cost, no transaction-level cost, no actual-cost-vs-reference-cost view. Big simplification.

From the second-pass review (2026-04-24, late):

11. **Packaging splits in two:** existing `packaging` category becomes `cell_packaging` (can, lid, terminals, o-rings, epoxy, vent cap, label, tape) and `module_packaging` (busbars, fasteners, PCB, module terminals). Two separate `category` values.
12. **Reorder point stays static; dynamic version deferred.** Add `lead_time_days` column to inventory items now so consumption-rate × lead-time math is possible later in a dashboard.
13. **Drop `inventory_items.capacity` column.** Capacity is a design/mix property, lives on `mixes.components.capacity_override` only. Frontend `formulation.js` seeds new mix components with `cap = 0` instead of inheriting from inventory.
14. **Three separate component-identifier fields replace `category`:**
    - `type` — physical/material classification (raw_chemical, separator, mesh, tab, tape, electrolyte, can, lid, terminal, o_ring, epoxy, vent_cap, label, busbar, fastener, pcb, module_terminal, other)
    - `process_step` — when it's used (paste, electrode, winding, cell_assembly, module_assembly)
    - `functionality` — what role it plays (active_material, performance_additive, binder, conductor, current_collector, separator, sealant, structural, label, electrical_connection)

    These are kept separate (not merged) so dropdowns can filter on each axis independently. The existing single `category` column stays for backward-compat as a legacy view but is deprecated.
15. **Multi-supplier on product recipes — minimal-invasive model.** Two inventory items can share the same `name` (different `supplier` values). Recipes still reference the component by name (no schema change). At production time, the operator's form lists all inventory items whose `name` matches the recipe line, with their supplier as the dropdown label; operator picks which one was used.

---

## 1. Unified data model

### 1.1 The simplification you unlocked

By choosing "every BOM component is an inventory item" (decision 1), we **drop the separate `bom_components` table** from the original strategy. Everything funnels through `inventory_items`. This is the cleaner architecture — one table, one source of truth for cost, qty, supplier, lots.

The only new tables needed are: `inventory_lots` (Option C) and a small change to wire lots into transactions/production logs.

### 1.2 Schema changes

#### A. Extend `inventory_items` with cost projections

```sql
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost_per_unit_gigascale FLOAT,  -- projected gigascale cost
  ADD COLUMN IF NOT EXISTS bom_category VARCHAR(50);       -- paste/mesh/tabs/separator/housing/electrolyte
                                                            -- drives the pie chart grouping
```

`cost_per_unit` already exists — that's the **BOM reference / current cost**. We keep it stable; shipments with different prices get tracked at the lot level (§1.3) without rewriting it. This matches your call to skip the BOM-vs-actual variance view for now while keeping the data available for later.

#### B. New `inventory_lots` table (Option C)

```sql
CREATE TABLE inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_number VARCHAR(100) NOT NULL,    -- "unspecified" used when receive form left blank
  supplier VARCHAR(255),               -- who actually shipped this lot (optional)
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- drives FIFO consumption order
  qty_received FLOAT NOT NULL,
  qty_remaining FLOAT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (inventory_item_id, lot_number)
);
CREATE INDEX idx_lots_item ON inventory_lots(inventory_item_id);
CREATE INDEX idx_lots_received ON inventory_lots(received_date);
```

Trigger to keep `inventory_items.quantity` in sync (denormalized cache):

```sql
CREATE OR REPLACE FUNCTION sync_inventory_quantity() RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
  SET quantity = COALESCE((SELECT SUM(qty_remaining) FROM inventory_lots WHERE inventory_item_id = COALESCE(NEW.inventory_item_id, OLD.inventory_item_id)), 0)
  WHERE id = COALESCE(NEW.inventory_item_id, OLD.inventory_item_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_inv_qty
AFTER INSERT OR UPDATE OR DELETE ON inventory_lots
FOR EACH ROW EXECUTE FUNCTION sync_inventory_quantity();
```

**Result:** existing UI that reads `inventory_items.quantity` keeps working with no changes. Lot data simply becomes available as an additional layer.

#### C. Wire lots into existing tables

```sql
-- Track which lot a transaction touched (nullable — degrades gracefully)
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
```

`production_log` doesn't need a schema change — it already creates one transaction row per consumed component; adding lot info to those rows is enough.

#### D. Cell parameters: nominal voltage + overhead components

```sql
-- The cell_param_presets.params is JSONB. We extend it (no schema change),
-- but we document the new keys here:
--
--   nominal_voltage_v   FLOAT   default 1.2
--   bom_overhead        OBJECT  {
--     terminals:    {inv_id: UUID, qty: 2,    unit: "pcs"},
--     electrolyte:  {inv_id: UUID, qty: 0.7,  unit: "kg"},
--     o_rings:      {inv_id: UUID, qty: 2,    unit: "pcs"},
--     vent_caps:    {inv_id: UUID, qty: 1,    unit: "pcs"},
--     tape:         {inv_id: UUID, qty: 116,  unit: "in"},
--     lids:         {inv_id: UUID, qty: 1,    unit: "pcs"},
--     can:          {inv_id: UUID, qty: 1,    unit: "pcs"},
--     labels:       {inv_id: UUID, qty: 1,    unit: "pcs"},
--     epoxy:        {inv_id: UUID, qty: 0.047,unit: "L"},
--     devcon:       {inv_id: UUID, qty: 0.667,unit: "ml"},
--     kapton:       {inv_id: UUID, qty: 0.15, unit: "m"},
--   }
```

JSONB means no migration. Existing presets without `bom_overhead` get sane defaults at the UI layer.

### 1.3 Cost-per-unit semantics (unified)

| Source | What it is | When used |
|---|---|---|
| `inventory_items.cost_per_unit` | Latest known cost — manually updated via the "Update inventory item" form | **All BOM math** — design cost, $/kWh, charts (Present Volume regime) |
| `inventory_items.cost_per_unit_gigascale` | Projected gigascale cost | When the BOM tab toggle is set to Gigascale |

That's it. Cost lives on the catalog item only. Lots track quantity, supplier, and dates — no cost columns. When prices change, someone opens the inventory item update form and types in the new `cost_per_unit`. The BOM tab math reads that value directly. No history, no variance views, no per-lot accounting overhead.

---

## 2. End-to-end data flow

### 2.1 Receive shipment (with or without lot)

```
User opens "Receive shipment" form
  → picks inventory item from dropdown
  → enters qty + lot number (optional) + supplier (optional)
  → click "Record"

Backend POST /api/v1/inventory/receive:
  1. If lot_number provided:
     - SELECT lot WHERE (inv_id, lot_number) = (item.id, lot_number)
     - If exists → UPDATE qty_received += qty, qty_remaining += qty
     - If not    → INSERT new lot row
  2. If no lot_number:
     - Find or create the "unspecified" lot for this item
     - Append qty to it
  3. Insert inventory_transactions row {qty_change=+qty, reason='received',
     inventory_lot_id=lot.id}
  4. Trigger updates inventory_items.quantity automatically

Frontend: success toast, inventory cache refreshes, all dropdowns reflect new qty

If pricing changed with this shipment, the user separately opens "Update
inventory item" and edits cost_per_unit. Cost is decoupled from receive —
it's a catalog-level fact, not a per-shipment fact.
```

**Graceful degradation:** team member who skips lot gets the same behavior as today. Team member who fills it in unlocks lot-level traceability (which lot went into which production batch).

### 2.2 Production batch (consumes lots)

```
User logs production: "Built 50 cells of design X"
  → backend computes BOM-per-cell from design X (see §3) → multiplies by 50
  → for each inventory item needed:
     - SELECT lots WHERE inv_id = X.id AND qty_remaining > 0
       ORDER BY received_date ASC  (FIFO; later: configurable)
     - Walk down lots, decrementing qty_remaining until total need is met
     - For each lot touched, insert inventory_transactions row with inventory_lot_id
  → return per-lot consumption summary (UI shows preview before commit)

If only "unspecified" lots exist for an item, that's where consumption draws.
If consumption would exceed total quantity, return 409 Conflict with the
specific items that are short.
```

### 2.3 Loading a design (BOM tab calculations)

```
User loads design X, navigates to BOM tab:
  1. Frontend already has design.layers, design.cell_params, sim_result, cap_result
  2. Frontend has cloudInventory cached (with cost_per_unit + bom_category)
  3. Compute per-component qty:
     - PASTE: for each cathode/anode mix component:
         qty_kg = comp.wt_pct/100 * pasteMass_g / 1000
     - MESH: for each electrode layer:
         look up the mesh inventory item (the one selected in formulation)
         qty_m = electrode_length_mm / 1000
     - SEPARATOR: for each separator layer:
         look up the separator inventory item
         qty_m = layer.computedLen_mm / 1000
     - TABS: from sim_result tab counts
         qty = num_cathode_tabs + num_anode_tabs (or ft of strip — depends on tab type)
     - OVERHEAD: read cell_params.bom_overhead, look up each by inv_id, use specified qty
  4. For each line: cost_per_unit = (regime === 'gigascale')
                                       ? inv.cost_per_unit_gigascale
                                       : inv.cost_per_unit
     line_cost = qty_in_inventory_unit * cost_per_unit
     (unit conversion if BOM-stored unit ≠ inventory unit)
  5. Group by bom_category → totals → pie chart
  6. Energy_Wh = cap_result.cell_cap_ah * cell_params.nominal_voltage_v
     $/kWh = total_cost / Energy_Wh * 1000
```

All client-side, deterministic, fast. No server roundtrip.

---

## 3. The BOM tab UI (final)

```
┌─ BOM ──────────────────────────────────────────────────────────────────┐
│  Design A: [gen2_mix1_combo1_trial1 ▼]   vs   Design B: [— None — ▼]   │
│  Regime:  (•) Present Volume   ( ) Gigascale                           │
│                                                                         │
│  ┌─ A: gen2_mix1_combo1_trial1 ─────────┐ ┌─ B: (none) ───────────────┐│
│  │ Cost/cell:    $43.29                  │ │                            ││
│  │ Energy:       247 Wh                  │ │                            ││
│  │ $/kWh:        $175                    │ │                            ││
│  │ Total mass:   2.69 kg                 │ │                            ││
│  │ $/kg:         $16.10                  │ │                            ││
│  └───────────────────────────────────────┘ └────────────────────────────┘│
│                                                                         │
│  ┌─ Category breakdown (pie) ──────────┐ ┌─ Cost/kWh vs energy ──────┐ │
│  │            Paste 47%                 │ │   [line chart, 2 series]   │ │
│  │            Mesh 20%                  │ │     PV: solid              │ │
│  │            Separator 10%             │ │     Gigascale: dashed      │ │
│  │            Housing 12%               │ │                            │ │
│  │            Tabs 4%                   │ │                            │ │
│  │            Electrolyte 7%            │ │                            │ │
│  └──────────────────────────────────────┘ └────────────────────────────┘ │
│                                                                         │
│  ┌─ Line items ─────────────────────────────────────────────────────┐  │
│  │ Cat       │ Component        │ Qty  │ Unit │ $/Unit │ $/Cell    │  │
│  │ Paste     │ EMD              │ 1.20 │ kg   │ 6.40   │  7.68     │  │
│  │ Paste     │ Zinc Powder      │ 0.40 │ kg   │ 5.56   │  2.22     │  │
│  │ ...                                                                │  │
│  │ Mesh      │ Nickel Mesh 6"   │ 1.83 │ m    │ 2.94   │  5.39     │  │
│  │ Separator │ Chaoli-140       │ 4.06 │ m    │ 0.69   │  2.82     │  │
│  │ Housing   │ Cell Can (Rev 3) │ 1    │ pcs  │ 2.39   │  2.39     │  │
│  │ ...                                                                │  │
│  │ ─────────────────────────────────────────────────────────────────  │  │
│  │ TOTAL                                              $43.29          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Overhead component config (from cell params) ─────────────────────┐ │
│  │ Component        │ Inventory Item                  │ Qty   │ Unit  │ │
│  │ Terminals        │ [Cell Terminals ▼]              │ 2     │ pcs   │ │
│  │ Electrolyte      │ [Electrolyte 25% KOH ▼]         │ 0.7   │ kg    │ │
│  │ O-rings          │ [Cell Terminal O-rings ▼]       │ 2     │ pcs   │ │
│  │ Vent Caps        │ [G&B Vent Caps ▼]               │ 1     │ pcs   │ │
│  │ Tape             │ [Patco 5560 Tape ▼]             │ 116   │ in    │ │
│  │ Lids             │ [Cylindrical Cell Lids ▼]       │ 1     │ pcs   │ │
│  │ Can              │ [Cylindrical Cell Can (Rev 3) ▼]│ 1     │ pcs   │ │
│  │ Labels           │ [Cell Labels ▼]                 │ 1     │ pcs   │ │
│  │ Epoxy            │ [Epoxy (Totalboat) ▼]           │ 0.047 │ L     │ │
│  │ Devcon           │ [Devcon Epoxy ▼]                │ 0.667 │ ml    │ │
│  │ Kapton           │ [Kapton Film Tape ▼]            │ 0.15  │ m     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

Notes:
- Selecting Design B reveals the comparison column (per your decision).
- Overhead config saves to the cell params preset on edit.
- Side-by-side view shows deltas highlighted (green = cheaper, red = more expensive).

---

## 4. Implementation order (revised)

### Phase 1 — Database & Ingestion (~1 day)

#### 1a. Schema changes (SQL in Redash)

```sql
-- Inventory cost projections + BOM category
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost_per_unit_gigascale FLOAT,
  ADD COLUMN IF NOT EXISTS bom_category VARCHAR(50);

-- Lots
CREATE TABLE inventory_lots (
  ... (schema in §1.2.B)
);

-- Trigger to keep inventory_items.quantity in sync
CREATE FUNCTION sync_inventory_quantity ...
CREATE TRIGGER trg_sync_inv_qty ...

-- Wire lots into transactions (lot id only — no cost, that lives on the catalog)
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
```

#### 1b. Data migration

```sql
-- Every existing inventory item gets one "legacy" lot containing its current quantity
INSERT INTO inventory_lots (inventory_item_id, lot_number, qty_received, qty_remaining, supplier, notes)
SELECT id, COALESCE(lot_number, 'unspecified'), quantity, quantity, supplier,
       'Auto-migrated from inventory_items at lot-system rollout'
FROM inventory_items
WHERE quantity > 0;
```

#### 1c. Inventory items for new BOM components (per your decision)

For each of the 18 BOM components not currently in inventory, INSERT a row. I'll generate the full SQL batch from `BAT_2026-003-Gen2_BOM_v1.0.xlsx`. Examples:

```sql
INSERT INTO inventory_items (name, category, unit, supplier, cost_per_unit, bom_category, notes)
VALUES
  ('Patco 5560 Tape',                'tape',         'in',  NULL, 0.009167, 'housing',
   'BOM ref: 116 in/cell @ $1.06'),
  ('Cylindrical Cell Can (Rev 3)',   'packaging',    'pcs', NULL, 2.39,     'housing',
   'BOM ref: 1 can/cell'),
  ('Electrolyte 25% KOH',            'electrolyte',  'kg',  NULL, 3.8892,   'electrolyte',
   'BOM ref: 0.7 kg/cell @ $2.72'),
  -- ... etc for all 18 missing components
;
```

#### 1d. Backfill cost + bom_category on existing items

```sql
UPDATE inventory_items SET cost_per_unit = 6.40,  bom_category = 'paste' WHERE name = 'EMD';
UPDATE inventory_items SET cost_per_unit = 5.56,  bom_category = 'paste' WHERE name = 'Zinc Powder';
UPDATE inventory_items SET cost_per_unit = 12.28, bom_category = 'paste' WHERE name = 'Graphite Imerys MX25';
-- ... etc for all 13 matched items
-- Plus: bom_category for separators, mesh, tabs based on category column
UPDATE inventory_items SET bom_category = 'separator' WHERE category = 'separator';
UPDATE inventory_items SET bom_category = 'mesh'      WHERE category = 'collector';
UPDATE inventory_items SET bom_category = 'tabs'      WHERE category = 'tab';
```

I'll generate the full ingestion SQL as a single `.sql` file for you to paste into Redash.

#### 1e. Mesh variants (per your decision)

```sql
-- Add the missing mesh variants as separate inventory items
INSERT INTO inventory_items (name, category, unit, cost_per_unit, density, width_mm, bom_category, notes)
VALUES
  ('Nickel Mesh 6" (220 Ah)',           'collector', 'm', 2.94,   0.16,  152.4, 'mesh', NULL),
  ('Copper Mesh 6" (220 Ah)',           'collector', 'm', 1.47,   0.149, 152.4, 'mesh', NULL),
  ('Folded Edge Copper Mesh 5.6875"',   'collector', 'm', NULL,   0.149, 144.5, 'mesh', 'Obsolete — kept for legacy designs'),
  ('Folded Edge Nickel Mesh 6.4375"',   'collector', 'm', NULL,   0.16,  163.5, 'mesh', 'Obsolete — kept for legacy designs');
-- The existing "Folded edge Nickel Mesh" stays as another variant.
```

### Phase 2 — Backend updates (~1 day)

- **Models** (`models.py`): `InventoryLot`, add `inventory_lot_id` + `cost_at_transaction` fields to `InventoryTransaction`.
- **Schemas** (`schemas.py`): `InventoryLotCreate`, `InventoryLotSchema`, extend `ReceiveShipmentRequest` with `lot_number` + `supplier` (no cost — cost stays on the catalog item, edited via the existing Update form).
- **Routers**:
  - `/api/v1/inventory/lots` — list/get/update/delete (read-only is fine for now; teams correct lot data via the receive flow).
  - `/api/v1/inventory/{item_id}/lots` — list lots for an item.
  - Update `POST /inventory/receive` to find-or-create the lot per §2.1.
  - Update `POST /inventory/physical-count` to optionally specify lot, defaulting to "unspecified".
  - Update `POST /production/log` to allocate FIFO across lots and emit one transaction per lot touched.

### Phase 3 — Frontend, Inventory side (~half day)

- **Receive shipment form**: add `lot_number` (optional), `supplier` (optional). No cost field on this form — cost is managed via the Update Inventory Item form when prices change.
- **Update inventory item form**: show a read-only sub-table of lots with their `qty_remaining` + `received_date`.
- **New "Lots" action in the inventory dropdown**: lets you adjust a specific lot directly (closing out, rebadging, etc.).
- **Production log preview**: before committing, show "this will consume EMD lot B2-011426 (1.5 kg) and lot B2-022626 (0.3 kg)" — based on FIFO simulation.

### Phase 4 — Frontend, BOM tab (~1.5 days)

- New tab between "Inventory" and any others in top nav.
- Summary cards (cost/cell, Wh, $/kWh, mass, $/kg) — design A, optional design B.
- Category pie (use Chart.js or plain SVG; the existing app has no chart lib so plain SVG is simplest).
- Cost/kWh vs energy line chart (read points directly off the cell, plot 60–200 Wh as in your reference sheet).
- Line-items table — read-only initially.
- Overhead-component dropdowns (per design): bound to `cell_params.bom_overhead`. Save round-trips through cell params preset save flow.
- Compare-to-design panel.
- PV/Gigascale toggle in header, persisted in localStorage.

### Phase 5 — Cell-params extension (~half day, can parallelize with Phase 4)

- Add `nominal_voltage_v` field to the Cell Parameters tab (default 1.2).
- Add the overhead block (11 dropdowns, each pointing to inventory; default suggestions based on the Gen2 BOM line items).
- Update `applyDesignPreset` / `getDesignPreset` to round-trip these fields.

### Phase 6 — Stretch (timing TBD)

- **Lot recall lookup UI** ("show me all production batches that used lot X").
- "What-if" sliders (per-component price multiplier).
- Supplier sensitivity (multi-supplier lookup per inventory item).

---

## 5. Decisions (locked in — simplest option for each)

1. **Lot consumption rule: FIFO only**, by `received_date`. No FEFO. Consequence: `expiration_date` is dropped from the lot schema (no consumer of it).

2. **Lot recall lookup: later** — Phase 6 stretch. For now, recall = a Redash SQL query. No UI surface in Phase 3.

3. **`requires_lot` flag: no.** Lot number is always optional. If discipline becomes a problem later we add the flag then.

4. **Pie chart: 6 top-level categories only** (Paste / Mesh / Tabs / Separator / Housing / Electrolyte). No drill-in interactions.

5. **`lot_number` on receive: optional.** If left blank, the system silently routes to the per-item "unspecified" lot. No nudging, no auto-generated names, no required asterisks.

6. **Inventory-item supplier vs lot supplier: independent fields.** No auto-update logic between them. Item-level = "preferred supplier on the spec sheet"; lot-level = "who actually shipped this batch this time".

---

## 6. What ships, what doesn't, when

| Capability | Phase 1 (DB) | Phase 2 (API) | Phase 3 (Inv UI) | Phase 4 (BOM tab) | Phase 5 (Cell params) | Stretch |
|---|---|---|---|---|---|---|
| Add 3 columns to `inventory_items` | ✅ | | | | | |
| `inventory_lots` table + trigger | ✅ | | | | | |
| Migrate existing items → 1 legacy lot each | ✅ | | | | | |
| Insert 18 missing BOM inventory items | ✅ | | | | | |
| Backfill costs + `bom_category` | ✅ | | | | | |
| Create mesh variants | ✅ | | | | | |
| Lot-aware receive_shipment API | | ✅ | | | | |
| Lot-aware production_log API | | ✅ | | | | |
| Lot list/manage endpoints | | ✅ | | | | |
| Receive form: lot/supplier/cost fields | | | ✅ | | | |
| Inventory item card: lot sub-table | | | ✅ | | | |
| Production preview: lot allocation | | | ✅ | | | |
| BOM tab — summary cards | | | | ✅ | | |
| BOM tab — pie chart | | | | ✅ | | |
| BOM tab — line items table | | | | ✅ | | |
| BOM tab — $/kWh chart | | | | ✅ | | |
| BOM tab — design comparison | | | | ✅ | | |
| BOM tab — PV/Gigascale toggle | | | | ✅ | | |
| Cell params: nominal voltage | | | | | ✅ | |
| Cell params: overhead dropdowns | | | | | ✅ | |
| Supplier sensitivity | | | | | | ⏳ |
| What-if sliders | | | | | | ⏳ |
| Lot recall lookup | | | | | | ⏳ |

**Total estimated: 4–5 working days for Phase 1–5.** I'd recommend serializing 1→2→3 and then doing 4+5 in parallel (different surfaces, low conflict risk).

---

## 7. Ready to start Phase 1

All 6 open questions are answered (§5). The simplest, internally-consistent path forward is:

- **Schema:** §1.2 — extra columns on `inventory_items`, `inventory_lots` table (no expiration date, no per-lot cost), one `inventory_lot_id` column on `inventory_transactions`, sync trigger.
- **Migration:** §4 Phase 1b — auto-create one "legacy" lot per existing item carrying its current quantity.
- **Receive flow:** lot # optional, blank lots route to the auto-created "unspecified" lot.
- **Consumption rule:** FIFO by `received_date`, no FEFO.
- **Pie chart:** 6 top-level categories, no drill-in.
- **Suppliers:** item-level and lot-level are independent.
- **Recall, what-if sliders, supplier sensitivity:** Phase 6 stretch, not in initial ship.

When you give the go-ahead I'll generate the full Phase 1 SQL script (single file, paste into Redash):

1. `ALTER TABLE inventory_items` — add `cost_per_unit_gigascale`, `bom_category`
2. `CREATE TABLE inventory_lots` (per §1.2.B)
3. `CREATE FUNCTION sync_inventory_quantity` + trigger
4. `ALTER TABLE inventory_transactions` — add `inventory_lot_id`
5. `INSERT INTO inventory_lots` — one "legacy" lot per existing item (qty migration)
6. `INSERT INTO inventory_items` — 18 new components missing from inventory (BOM-driven)
7. `INSERT INTO inventory_items` — 4 mesh variants
8. `UPDATE inventory_items SET cost_per_unit, bom_category` — backfill costs and categories from the BOM Excel

Phase 2 backend changes follow as one PR.
