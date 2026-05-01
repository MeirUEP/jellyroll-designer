# Jellyroll Battery Cell Designer

A web application for designing wound cylindrical battery cells (jellyroll construction) and managing the inventory and BOM cost data behind them. Three pages share a single password gate:

- **Cell Designer** — variable-pitch winding simulation, tab placement, formulation, BOM cost
- **Inventory Dashboard** — items, lots, low-stock alerts, receive shipments, physical counts
- **Landing page** — auth + page picker

## Features

### Cell designer
- Variable-pitch spiral winding simulation (phase-based: overhang → pre-wind → cathode wind → main wind → anode extension → final wrap)
- 5 interactive views: Side, Top, Unroll, Tab Map, 3D (Three.js)
- Editable layer stack with reordering
- Cathode and anode tab placement via constraint solver
- Inventory-driven cathode/anode mix formulation
- Cell capacity calculation
- BOM cost-per-cell, $/kWh, and category pie chart per design
- Cell Assembly overhead dropdowns (terminals, electrolyte, vent caps, etc.)
- CSV/PDF export, JSON save/load, cloud save (FastAPI backend)
- Dark theme

### Inventory dashboard
- Items table with sort, filter (type/process/BOM category), and name search
- Lot-level tracking (FIFO consumption, opt-in per shipment)
- Quick-stat cards (total items, low-stock count, categories)
- Add/Update/Receive/Physical-count modals
- Low-stock alerts

## Usage

Open `index.html` in a browser, or visit the deployed GitHub Pages site / production VM. Enter the password on the landing page, then choose Designer or Inventory.

## Deployment

- Frontend: auto-deployed to GitHub Pages on push to `main` via GitHub Actions
- Production VM (`143.198.122.92:8000`): pulls from GitHub every minute via crontab
- Backend (FastAPI/uvicorn) on the VM serves the same static files and provides the API

See `SYSTEM.md` (gitignored) for full operational details.
