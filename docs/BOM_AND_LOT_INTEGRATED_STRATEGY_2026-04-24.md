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

From the third-pass review (2026-04-30, post Phase 1+2 execution):

16. **Two-page architecture.** Single landing page with password gate, then the user picks one of two destinations:
    - **Designer** (current app, renamed to `designer.html`) — workspace for building/simulating a cell. The inventory tab/modal inside this page stays as it is — design-scoped, showing quantities and costs relevant to the loaded design.
    - **Inventory Dashboard** (`inventory.html`) — standalone full-page tool for general inventory operations: see all items, add/update items, receive shipments, run physical counts. No design context.

    Auth shared via `sessionStorage.jr_auth`; once you enter the password on the landing page, both destinations are unlocked.

17. **Dashboard MVP is basic ops only.** Items table with sort/filter/search, quick-stat cards, low-stock alert, lots sub-rows, and the four core action modals (add item, receive, count, update). Everything else (transactions ledger, production log history, supplier views, charts, dynamic reorder, exports, roles) deferred to later phases.

18. **Once the dashboard is ready, remove the Inventory button from the Designer page.** The designer reads inventory (component dropdowns in the Formulation tab, mesh picker, layer-stack add) but no longer hosts the management modals. Add/Update/Receive/Count/Recipe/Production all move to the standalone dashboard. Cleaner separation of concerns: the Designer is a workspace, the Dashboard is for ops.

    Cleanup deferred to **Phase 4b** (post-dashboard ship): delete the `Inventory Management` button + modal markup from `designer.html`, drop the `openInventoryModal()` entry-point but keep the form-rendering helpers in `inventory-ui.js` so the dashboard can reuse them.

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

## 4. Implementation order (revised — execution log inline)

### ✅ Phase 1 — Database & Ingestion (DONE 2026-04-30)

Executed via `backend/sql/009_bom_and_lots_phase1.sql`. All six verification gates passed:

| Gate | Result |
|---|---|
| A. Schema | ✅ 6 new columns live (`cost_per_unit_gigascale`, `bom_category`, `type`, `process_step`, `functionality`, `lead_time_days`) |
| B. Lots created | ✅ 37 legacy lots auto-migrated from items with qty > 0 |
| C. Quantity reconciliation | ✅ Zero drift between items and SUM(lots.qty_remaining); trigger working |
| D. BOM coverage | ✅ All 6 categories populated (paste 13, mesh 6, tabs 4, separator 3, housing 7, electrolyte 2) |
| E. Identifiers | ✅ All non-finished-good items have `type` / `process_step` / `functionality` |
| F. Packaging split | ✅ cans/lids/terminals/o_rings/labels/vent_caps under `cell_assembly`; busbars/fasteners/module_* under `module_assembly` |

Notes from execution:
- The legacy migration carried suppliers through correctly (e.g. EMD's "Vibrantz Technologies" preserved on its `unspecified` lot).
- Items without a clean BOM-name match got new inventory rows inserted with the BOM name (Acetylene Black, Zirconia (ZrO2), Cylindrical Cell Lids, Cell Terminals, Cylindrical Cell Can (Rev 3), Devcon Epoxy, Cell Labels, etc.) — manual consolidation against existing variants (e.g. "Zirconium Oxide", "Cylindrical Cell Cans rev 3/4") deferred to user cleanup.
- `EXECUTE PROCEDURE` (legacy spelling) used instead of `EXECUTE FUNCTION` because the Redash-bundled Postgres is older than PG 11.

#### 1a. Schema changes (SQL in Redash)

```sql
-- Inventory cost projections + BOM category
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost_per_unit_gigascale FLOAT,
  ADD COLUMN IF NOT EXISTS bom_category VARCHAR(50);

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

### ✅ Phase 2 — Backend updates (DONE 2026-04-30)

Live as of `git rev 3134d98`. All four smoke tests passed against `http://143.198.122.92:8000`:

| Test | Result |
|---|---|
| 1. List EMD's lots (existing) | ✅ One `unspecified` lot with 9405.79 lbs, supplier "Vibrantz Technologies" preserved from migration |
| 2. Receive 100 lbs into a new "TEST-LOT-001" | ✅ New lot auto-created via `_find_or_create_lot()`, txn record carries `inventory_lot_id` |
| 3. Re-list EMD lots | ✅ Two lots returned, FIFO-sorted by `received_date` |
| 4. Item-level qty reconciliation | ✅ `inventory_items.quantity = 9505.79` (was 9405.79 + 100) — DB trigger fired correctly |

Files changed:
- `backend/app/models.py` — added `InventoryLot`, all new InventoryItem columns, `inventory_lot_id` on transactions, deprecation comments on `category` / `lot_number` / `capacity`.
- `backend/app/schemas.py` — `InventoryLotCreate/Update/Schema`, all the new InventoryItem fields, `ProductionLogRequest.selections` for multi-supplier picker, `ProductionPreview` response model.
- `backend/app/routers/inventory.py` — new `_find_or_create_lot` helper; new endpoints `GET/PUT/DELETE /inventory/lots/{id}`, `GET /inventory/{id}/lots`, `POST /production/preview`, `GET /production/component-options`; rewrote receive/count/production paths to be lot-aware (FIFO walk, one txn per lot).
- `js/api.js` — added `listLotsForItem`, `getLot`, `updateLot`, `deleteLot`, `previewProduction`, `componentOptions`.

### Phase 3 — Designer-side inventory polish (~half day, NOT STARTED)

Lightweight updates to the existing inventory modal inside the Designer page. The modal stays as-is — it's the design-scoped inventory tool and remains contextual to whatever cell you have loaded.

- **Receive shipment form**: add `lot_number` (optional) and `supplier` (optional) inputs. POST sends them to `/inventory/receive`. Toast shows which lot was touched.
- **Update inventory item form**: append a read-only sub-table of lots beneath the editable fields (lot #, supplier, received date, qty_remaining; sorted FIFO).
- **Production log preview**: before commit, call `/production/preview` and show the operator which lots will be consumed for each recipe component. Multi-supplier dropdown per recipe line, pulled from `/production/component-options`.
- **No new frontend modules needed** — all changes live in `js/inventory-ui.js`.

### Phase 4 — Standalone Inventory Dashboard (~half day, NOT STARTED)

New top-level destination per decision 16. Three new HTML files reorganize the app:

```
http://143.198.122.92:8000/
  └── index.html         → landing page (password gate + 2 buttons)
       ├── /designer.html    → current designer app (rename existing index.html)
       └── /inventory.html   → new standalone dashboard
```

Shared auth via `sessionStorage.jr_auth='1'` set on landing, read on the others. Hitting `/designer.html` or `/inventory.html` without auth redirects to `/`.

Dashboard MVP scope (decision 17 — basic ops only):

- **Quick stats** card: total items, low-stock count, total lots
- **Action buttons**: Add new item • Receive shipment • Physical count
- **Items table** with sort + filter (by `type`, `process_step`, `bom_category`) + name search
  - Columns: name, type, process step, qty, unit, cost, supplier, lot count, low-stock flag
  - Click a row → opens Update Inventory Item modal
  - Click the "lots" cell → expands an inline sub-row showing all lots for that item
- **Low stock callout** at the bottom listing items where `quantity ≤ reorder_point`
- **Header link**: "→ Cell Designer" cross-navigation
- **Reuses all existing modals** from `js/inventory-ui.js` (Add Item, Receive, Update, Count) — just adds the dashboard wrapper around them.

Out of scope for MVP: transactions ledger view, production log history, supplier-grouped views, charts, exports, dynamic-reorder-point math, role separation.

Implementation:
1. Rename `index.html` → `designer.html` (no functional change).
2. Create new `index.html` as landing page (password + Designer/Inventory buttons).
3. Create `inventory.html` with the dashboard scaffold.
4. Create `js/inventory-dashboard.js` for the table/sort/filter logic (modals stay in `inventory-ui.js`).
5. Update `js/auth.js` to handle the post-auth redirect (already-authed users land on the picker; clicking a button just navigates).

### Phase 4b — Remove Inventory Management from Designer (~1 hour, after Phase 4 ships)

Per decision 18 — once the dashboard is the primary surface for inventory ops, strip the management UI out of the designer:

- Remove the cyan "Inventory" button from the designer's bottom action bar (currently sits between "+ Experimental" and the gear icon).
- Remove the `<div id="modalInventory">` markup and its sub-forms from `designer.html`.
- Drop the `openInventoryModal()` entry point in `js/inventory-ui.js`.
- Keep the form-rendering helpers (`renderAddItemForm`, `renderReceiveForm`, `renderUpdateItemForm`, `renderCountForm`) — they're now reused by `inventory.html`.
- The Formulation tab's read-only inventory dropdowns (mesh selector, chemical adders) stay — those are designer-internal reads.
- Cross-link: add a small "Manage inventory" link in the designer header that opens `/inventory.html` in a new tab, in case a designer needs to receive a shipment without losing their loaded design.

### Phase 5 — Frontend BOM tab inside Designer (~1.5 days, NOT STARTED)

Inside the Designer page, between the Formulation tab and the Layers tab. Computes per-cell cost from the loaded design.

- New tab "BOM" in the designer's top nav.
- Summary cards (cost/cell, Wh, $/kWh, mass, $/kg) — design A, optional design B for compare mode.
- Category pie chart (plain SVG; no chart lib).
- Cost/kWh vs energy line chart (60–200 Wh sweep; PV solid + Gigascale dashed).
- Line-items table grouped by `bom_category`.
- PV/Gigascale toggle in tab header, persisted in localStorage.
- Compare-to-saved-design panel.

### Phase 6 — Cell-params extension inside Designer (~half day, can parallelize with Phase 5)

- Add `nominal_voltage_v` field to the Cell Parameters tab (default 1.2 V).
- Add the `bom_overhead` block — 11 inventory dropdowns (terminals, electrolyte, O-rings, vent caps, tape, lids, can, labels, epoxy, devcon, kapton) each with a qty + unit field. Stored in `cell_params.bom_overhead` JSONB.
- Update `applyDesignPreset` / `getDesignPreset` to round-trip these fields.

### Phase 7 — Stretch (timing TBD)

- **Lot recall lookup UI** ("show me all production batches that used lot X")
- **Transactions ledger** view in the dashboard
- **Production log history** view in the dashboard
- **Supplier-grouped views** (which items come from which supplier; supplier sensitivity analysis)
- **What-if price sliders** in the BOM tab
- **CSV export** for items/lots/transactions
- **Dynamic reorder point** computation (consumption_rate × lead_time × safety_factor) on the dashboard
- **User roles** (operator vs engineer vs admin)

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

Status as of 2026-04-30:

| Capability | P1 DB | P2 API | P3 Designer Inv | P4 Dashboard | P5 BOM tab | P6 Cell params | Stretch |
|---|---|---|---|---|---|---|---|
| Add 6 columns to `inventory_items` | ✅ done | | | | | | |
| `inventory_lots` table + trigger | ✅ done | | | | | | |
| Migrate existing items → 1 legacy lot each | ✅ done | | | | | | |
| Insert missing BOM inventory items (14) | ✅ done | | | | | | |
| Insert mesh variants (6) | ✅ done | | | | | | |
| Backfill costs + `bom_category` | ✅ done | | | | | | |
| Migrate `category` → `type`/`process_step`/`functionality` | ✅ done | | | | | | |
| Lot-aware `/inventory/receive` | | ✅ done | | | | | |
| Lot-aware `/inventory/physical-count` | | ✅ done | | | | | |
| Lot-aware `/production/log` (FIFO walk) | | ✅ done | | | | | |
| `/inventory/{id}/lots` listing | | ✅ done | | | | | |
| `/inventory/lots/{id}` GET/PUT/DELETE | | ✅ done | | | | | |
| `/production/preview` (FIFO dry-run) | | ✅ done | | | | | |
| `/production/component-options` (multi-supplier picker) | | ✅ done | | | | | |
| Designer Receive form: lot/supplier fields | | | ⏳ | | | | |
| Designer Update Item form: lot sub-table | | | ⏳ | | | | |
| Designer Production form: per-line supplier picker + preview | | | ⏳ | | | | |
| Landing page `/` (password + 2 buttons) | | | | ⏳ | | | |
| Rename `index.html` → `designer.html` | | | | ⏳ | | | |
| Standalone `inventory.html` dashboard | | | | ⏳ | | | |
| Items table (sort + filter + search) | | | | ⏳ | | | |
| Lots sub-row expand | | | | ⏳ | | | |
| Quick-stat cards + low-stock callout | | | | ⏳ | | | |
| Remove Inv Management button from Designer (P4b) | | | | ⏳ | | | |
| BOM tab — summary cards | | | | | ⏳ | | |
| BOM tab — pie chart | | | | | ⏳ | | |
| BOM tab — line-items table | | | | | ⏳ | | |
| BOM tab — $/kWh chart | | | | | ⏳ | | |
| BOM tab — design comparison | | | | | ⏳ | | |
| BOM tab — PV/Gigascale toggle | | | | | ⏳ | | |
| Cell params — nominal voltage field | | | | | | ⏳ | |
| Cell params — `bom_overhead` dropdowns | | | | | | ⏳ | |
| Lot recall lookup UI | | | | | | | ⏳ |
| Transactions ledger view | | | | | | | ⏳ |
| Production log history view | | | | | | | ⏳ |
| What-if price sliders | | | | | | | ⏳ |
| Supplier sensitivity | | | | | | | ⏳ |
| CSV export | | | | | | | ⏳ |
| Dynamic reorder point | | | | | | | ⏳ |
| User roles | | | | | | | ⏳ |

**Estimated remaining: 3–4 working days for P3 + P4 + P5 + P6.**

Recommended ordering:
- **P3 + P4 in parallel** (small surface; both touch `inventory-ui.js` but different entry points)
- Then **P5 + P6 in parallel** (BOM tab depends on cell-params overhead inputs; both inside Designer)

---

## 7. Next session — start Phase 3 + Phase 4

**Decisions still locked in (§5):** FIFO only, recall later, no `requires_lot` flag, pie 6 categories, lot # optional, suppliers independent.

**Phase 3 work** (`js/inventory-ui.js` only):
- Add `lot_number` and `supplier` text inputs to the Receive Shipment form. Submit sends them; success toast confirms which lot was touched.
- Append a read-only lots table to the Update Inventory Item form. Pulls from `GET /inventory/{id}/lots`.
- Add multi-supplier dropdown per recipe line in the Production form. Pulls from `GET /production/component-options?product=...`. Before commit, call `POST /production/preview` and show the FIFO allocation modal.

**Phase 4 work** (new files):
- `index.html` (new landing page, password + 2 buttons)
- `designer.html` (renamed from current `index.html`, no functional change)
- `inventory.html` (new standalone dashboard)
- `js/inventory-dashboard.js` (table/sort/filter logic, reuses modals from `inventory-ui.js`)
- `js/auth.js` updates so all three pages share the same `sessionStorage.jr_auth` token and unauthed access bounces back to `/`.

**No backend changes needed for P3 or P4 — all data is already exposed by Phase 2 endpoints.**

When ready to start, just say "go on Phase 3" or "go on Phase 4" or "do both in one push".
