// Layer types are roles in the wound stack only. Mesh/collectors belong
// to the cathode and anode designs (they live inside the electrode mix),
// tabs and tape are cell-assembly components attached post-winding.
// All three are tracked in inventory but not exposed as layers.
const LAYER_TYPES = ['anode','cathode','separator','other'];
let layers = [
  {name:'Anode',type:'anode',t:1.0,w:222,color:'#16a34a'},
  {name:'Kraft paper',type:'separator',t:0.15,w:228,color:'#b45309'},
  {name:'Cellophane A',type:'separator',t:0.05,w:226,color:'#38bdf8'},
  {name:'Cellophane B',type:'separator',t:0.05,w:226,color:'#7dd3fc'},
  {name:'Cathode',type:'cathode',t:2.0,w:188,color:'#3b82f6'},
  {name:'Cellophane C',type:'separator',t:0.05,w:226,color:'#38bdf8'},
  {name:'Cellophane D',type:'separator',t:0.05,w:226,color:'#7dd3fc'},
  {name:'Kraft paper 2',type:'separator',t:0.15,w:228,color:'#d97706'},
  {name:'PVA lam.',type:'separator',t:0.1,w:224,color:'#a855f7'},
];

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
};

let simResult = null;
let capResult = null;
let currentView = 'side';
let debounceTimer = null;

// Electrode properties (Rev 3 Can defaults from JellyRollModel_CORRECTED.xlsx)
let elecProps = {
  cath_bulk_density: 2.41,    // g/cm³ (with mesh)
  cath_active_wt: 0.75,       // EMD wt%
  cath_spec_cap: 250,         // mAh/g EMD
  cath_mesh_dens: 0.16,       // g/in² Ni mesh
  anod_bulk_density: 4.062,   // g/cm³ (with mesh)
  anod_zn_wt: 0.75,           // Zn wt%
  anod_zno_wt: 0.16,          // ZnO wt%
  anod_zn_cap: 820,           // mAh/g Zn
  anod_zno_cap: 660,          // mAh/g ZnO
  anod_mesh_dens: 0.149,      // g/in² Cu mesh
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

