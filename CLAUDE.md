# Jellyroll Designer

Battery cell jellyroll winding simulator and production management system.

## First thing every session

Read `SYSTEM.md` in the repo root before doing any work. It contains all infrastructure details, credentials, deploy commands, database architecture, and operational procedures. It is gitignored and local-only.

Whenever you make changes that affect system architecture, infrastructure, deploy procedures, database schema, new API routes, environment variables, or file structure — update `SYSTEM.md` to reflect those changes before finishing the task.

## File structure

```
index.html              → Landing page (password gate → Designer / Inventory buttons)
designer.html           → Cell Designer (simulation, formulation, views)
inventory.html          → Standalone Inventory Dashboard
css/style.css           → Shared stylesheet (dark/light theme)
js/
  api.js                → API client + cloud cache + conversion helpers
  auth.js               → Auth gate + session management (shared across pages)
  formulation.js        → Cathode/anode mix editor (inventory-driven)
  presets.js             → Preset save/load (design, cathode, anode, layers)
  state.js              → Global state (layers, params, elecProps, simResult)
  sim-engine.js          → Phase-based winding simulation + constraint solver
  capacity.js           → Cell capacity calculation
  ui.js                 → Info bar, summary, layer editor, results tables
  views.js              → Side, Top, Unroll, Tab Map renderers
  three-view.js         → Three.js 3D view
  events.js             → Button handlers, CSV/PDF export, cloud save/open
  inventory-check.js    → Inventory feasibility analysis (can we build N cells?)
  inventory-ui.js       → Inventory modal forms (Add, Update, Receive, Count, Recipe, Production)
  inventory-dashboard.js → Dashboard table/sort/filter logic (inventory.html only)
backend/
  app/main.py           → FastAPI app, CORS, routes for /, /designer.html, /inventory.html
  app/models.py         → 12 SQLAlchemy models (Design, Mix, LayerStack, InventoryItem, InventoryLot, etc.)
  app/schemas.py        → Pydantic request/response models
  app/routers/          → 8 routers (designs, inventory, mixes, layer_stacks, chemicals, materials, cell_param_presets, simulations)
  alembic/versions/     → Database migrations
  sql/                  → Direct SQL scripts for production schema changes
docs/
  BOM_AND_LOT_INTEGRATED_STRATEGY_2026-04-24.md → Full BOM + inventory strategy with phase tracking
jellyroll-designer-spec.md → Simulation engine spec (geometry, tab placement, views)
```

## Key rules

- VM commands: Claude has no SSH access. Write commands for the user to paste into the DigitalOcean web console. Never include inline `#` comments in commands meant for the user to execute.
- Cache-busting: after any JS change, bump the version suffix on all script tags in BOTH `designer.html` AND `inventory.html` (e.g. `?v=20260501a` → `?v=20260501b`). The landing page `index.html` has no external JS files.
- DB changes: prefer Redash SQL for production schema changes (user runs them manually). Update `models.py` + `schemas.py` to match.
- Commits: do not commit unless explicitly asked.
- Auto-run disabled: simulation only runs on "Run Simulation" button click (solver is expensive). `markDirty()` just highlights the button yellow.

## Simulation engine

Phase-based winding model in `js/sim-engine.js`:
1. **Overhang** — separator folds over split mandrel (separator_grab_distance mm)
2. **Pre-wind** — separator-only turns (exact, user-set)
3. **Cathode wind** — cathode + separator (exact turns before anode enters)
4. **Main wind** — all layers to target OD (radius-dependent pitch with tension factor)
5. **Anode extension** — anode continues past cathode end, constrained by angular safety
6. **Final wrap** — separator fills remaining gap to exact target OD

Tab placement uses a **constraint solver** that sweeps first cathode tab position (4.5–5.0") to find optimal drill angle satisfying:
- First anode tab lands at 6.0–6.5" along anode
- Electrode start/end angles ≥ 30° from tab zones (±10°)
- Inner zone (starts) and outer zone (ends) checked independently

## Auth flow

- `index.html` — password gate, sets `sessionStorage.jr_auth = '1'`
- `designer.html` and `inventory.html` — redirect to `/` if auth missing
- Shared via `sessionStorage` (per-tab, clears on browser close)

## Inventory architecture

- Lot-based tracking with FIFO consumption (opt-in per shipment)
- `inventory_items.quantity` kept in sync by PostgreSQL trigger on `inventory_lots`
- Cost lives on catalog item only (no per-lot cost)
- Experimental results: `designs.is_experimental = true` + `experimental_data` JSONB column

## Implementation status

See `docs/BOM_AND_LOT_INTEGRATED_STRATEGY_2026-04-24.md` for full phase tracking.
- Phase 1 (DB schema): Done
- Phase 2 (Backend API): Done
- Phase 3 (Designer inventory forms): Done
- Phase 4 (Inventory dashboard): Done
- Phase 4b (Remove inv from designer): Pending — after dashboard confirmed working
- Phase 5 (BOM tab): In progress
- Phase 6 (Cell params extension): Pending
