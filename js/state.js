// Layer types are roles in the wound stack only. Mesh/collectors belong
// to the cathode and anode designs (they live inside the electrode mix),
// tabs and tape are cell-assembly components attached post-winding.
// All three are tracked in inventory but not exposed as layers.
const LAYER_TYPES = ['anode','cathode','separator','other'];
// Start empty — layers are built from inventory (separators) and saved
// mixes (electrodes) via the add-layer dropdowns. No hardcoded defaults.
let layers = [];

// Machine constants (not user-editable, not saved per design)
const SEPARATOR_GRAB_DISTANCE = 129;  // mm — blade-to-mandrel distance, fixed machine geometry

let params = {
  mandrel_d: 10.75, target_od: 94, cell_h: 222,
  pre_turns: 1.5,               // exact insulation pre-turns (separator-only before cathode)
  min_cath_to_anod: 1.8,        // exact turns of cathode+sep winding before anode enters
  tab_w: 10, tab_h: 15,
  first_cath_tab_min_in: 4.5,   // min 1st cathode tab position along cathode (inches)
  first_cath_tab_max_in: 5.0,   // max 1st cathode tab position along cathode (inches)
  first_anod_tab_min_in: 6.0,   // min 1st anode tab position along anode (inches)
  first_anod_tab_max_in: 6.5,   // max 1st anode tab position along anode (inches)
  tab_zone_half_deg: 10,        // tabs occupy ±this angle for safety clearance checks
  min_clearance_deg: 30,        // min angular separation between events and tab zones
  length_tolerance: 5,          // electrode cut length tolerance (±mm)
  cath_weld_from_tab: 1,        // start cathode welding from tab N (skip inner tabs)
  anod_weld_from_tab: 1,        // start anode welding from tab N (skip inner tabs)
  tension_factor: 1,            // 1 = perfect winding, <1 = looser (air gap increases pitch)
  winding_gap_k: 0,             // radius-dependent gap: pitch *= (1 + k*r0/r). Models inner wrinkling.
  nominal_voltage_v: 1.2,       // cell nominal voltage for energy and $/kWh calculations
  bom_overhead: {},             // fixed-qty components: { key: { inv_id, qty, unit } }
};

let simResult = null;
let capResult = null;
let currentView = 'side';
let debounceTimer = null;

// Electrode properties — bulk density, thickness, mesh density are physical
// design properties of the electrode. composite_cap (mAh/g of paste) is
// computed from Σ(wt% × cap) over the mix components; it's stamped here by
// updateFormulation() so capacity.js can read it. No "active material" flag
// needed — inactive components have cap=0 and drop out naturally.
let elecProps = {
  cath_bulk_density: 2.41,       // g/cm³ (with mesh)
  cath_thickness: 1.0,           // mm — cathode paste thickness
  cath_mesh_dens: 0.16,          // g/in² Ni mesh
  cath_composite_cap: 0,         // mAh/g — Σ(wt% × cap) of cathode mix
  anod_bulk_density: 4.062,      // g/cm³ (with mesh)
  anod_thickness: 1.0,           // mm — anode paste thickness
  anod_mesh_dens: 0.149,         // g/in² Cu mesh
  anod_composite_cap: 0,         // mAh/g — Σ(wt% × cap) of anode mix
};

// 3D state
let threeScene, threeCamera, threeRenderer, threeControls;
let autoSpin = false;
let threeInited = false;

// Legend visibility
let layerVisibility = {};

// Helper: effective length for a layer (computed for open-ended types, input for fixed)
function layerLen(l) {
  return (['anode','cathode','separator'].includes(l.type) && l.computedLen) ? l.computedLen : (l.len || 0);
}

