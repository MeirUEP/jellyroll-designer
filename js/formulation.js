// ========== LEFT PANEL TABS ==========
document.querySelectorAll('.left-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.left-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.left-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('ltab-' + btn.dataset.ltab).classList.add('active');
  });
});

// ========== FORMULATION ENGINE (inventory-driven) ==========
// Each component now carries `inventory_item_id` — the link back to the
// inventory record that defines density/capacity/is_active_mat. Only wt%
// is editable in the row; density and cap are displayed read-only from
// the linked inventory item. Components with no inventory link are
// legacy rows (loaded from old designs) and will show an orange banner.
const cathComponents = [];
const anodComponents = [];

function buildMixTable(components, bodyId, totalId, solidDensId, compCapId, electrode) {
  const body = document.getElementById(bodyId);
  body.innerHTML = '';
  components.forEach((c, i) => {
    const inv = c.inventory_item_id ? invById(c.inventory_item_id) : null;
    const orphan = !inv;
    // Density is a physical property — always read from live inventory when
    // we have a link, otherwise fall back to whatever was snapshotted.
    const densVal = inv ? (inv.density ?? 0) : (c.density || 0);
    // Capacity is a DESIGN CHOICE (derating, spec targets, lot-specific
    // numbers). Owned by the component, seeded from inventory on add,
    // user-editable thereafter. We surface the inventory default in the
    // tooltip so users can see how far they've deviated.
    const capVal = c.cap != null ? c.cap : (inv ? (inv.capacity || 0) : 0);
    const invCapDefault = inv ? (inv.capacity || 0) : null;
    const capTooltip = invCapDefault != null
      ? `Inventory default: ${invCapDefault} mAh/g — override for this design`
      : 'Specific capacity (mAh/g)';
    const nameDisplay = inv ? inv.name : (c.name || '(unlinked)');
    const stockHint = inv ? `${inv.quantity} ${inv.unit} in stock` : '';
    const tr = document.createElement('tr');
    if (orphan) tr.style.background = 'rgba(245,158,11,0.12)';
    tr.innerHTML = `
      <td title="${orphan ? 'Not linked to inventory — pick a replacement' : stockHint}">
        <span style="font-size:10px;${orphan ? 'color:#f59e0b' : ''}">${nameDisplay}</span>
        ${orphan ? '<span style="font-size:8px;color:#f59e0b">⚠</span>' : ''}
      </td>
      <td><input type="number" step="0.01" value="${c.wt}" data-ci="${i}" data-field="wt" style="width:50px"></td>
      <td style="color:var(--fg2);font-size:10px">${densVal ? densVal.toFixed(2) : '—'}</td>
      <td><input type="number" step="1" value="${capVal}" data-ci="${i}" data-field="cap" title="${capTooltip}" style="width:55px"></td>
      <td style="white-space:nowrap">
        <button class="btn-sm" data-del-comp="${i}" data-electrode="${electrode}" title="Remove" style="padding:1px 3px;font-size:8px;background:var(--red);color:#fff">&times;</button>
      </td>`;
    body.appendChild(tr);
  });

  // wt% input
  body.querySelectorAll('input[data-field="wt"]').forEach(inp => {
    inp.addEventListener('change', e => {
      const ci = +e.target.dataset.ci;
      components[ci].wt = +e.target.value;
      updateFormulation(components, totalId, solidDensId, compCapId, electrode);
      markDirty();
    });
  });

  // Capacity override input — user-owned, persists with the design
  body.querySelectorAll('input[data-field="cap"]').forEach(inp => {
    inp.addEventListener('change', e => {
      const ci = +e.target.dataset.ci;
      components[ci].cap = +e.target.value;
      updateFormulation(components, totalId, solidDensId, compCapId, electrode);
      markDirty();
    });
  });

  // Delete component from mix
  body.querySelectorAll('[data-del-comp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ci = +btn.dataset.delComp;
      const elec = btn.dataset.electrode;
      components.splice(ci, 1);
      buildMixTable(components, bodyId, totalId, solidDensId, compCapId, elec);
      markDirty();
    });
  });

  updateFormulation(components, totalId, solidDensId, compCapId, electrode);
}

// Add a component by picking from the inventory dropdown. Reads the
// selected inventory item and pushes a new row with inventory_item_id set
// and cached density/cap (the snapshot — refreshed from live inventory
// every render).
function addCompFromInventory(electrode) {
  const selId = electrode === 'cathode' ? 'cathInvLib' : 'anodInvLib';
  const sel = document.getElementById(selId);
  const invId = sel.value;
  if (!invId) { showToast('Pick a chemical from the dropdown first', true); return; }
  const inv = invById(invId);
  if (!inv) { showToast('Inventory item not found', true); return; }

  const comps = electrode === 'cathode' ? cathComponents : anodComponents;
  if (comps.some(c => c.inventory_item_id === invId)) {
    showToast(`${inv.name} is already in the mix`, true);
    return;
  }
  comps.push({
    inventory_item_id: invId,
    name: inv.name,                     // snapshot name for legacy compat
    wt: 0,
    density: inv.density || 0,
    cap: inv.capacity || 0,
    isActive: !!inv.is_active_mat,
  });
  const [bodyId, totalId, solidDensId, compCapId] = electrode === 'cathode'
    ? ['cathMixBody', 'cathMixTotal', 'cathSolidDens', 'cathCompCap']
    : ['anodMixBody', 'anodMixTotal', 'anodSolidDens', 'anodCompCap'];
  buildMixTable(comps, bodyId, totalId, solidDensId, compCapId, electrode);
  sel.value = '';
  markDirty();
}

// Populate the inventory-backed dropdowns (chemical adder + mesh picker)
// from cloudInventory. Called on startup and whenever inventory changes.
function refreshFormulationFromInventory() {
  // Chemical adders
  const chemItems = invByCategory('raw_chemical').sort((a, b) => a.name.localeCompare(b.name));
  ['cathInvLib', 'anodInvLib'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">+ Add chemical from inventory...</option>` +
      chemItems.map(i => {
        const activeTag = i.is_active_mat ? ' • active' : '';
        const densTag = i.density ? ` • ${i.density} g/cm³` : '';
        const stockTag = (i.quantity != null) ? ` — ${i.quantity} ${i.unit}` : '';
        return `<option value="${i.id}">${i.name}${densTag}${activeTag}${stockTag}</option>`;
      }).join('');
    sel.value = cur;
  });

  // Mesh pickers (collector category)
  const meshItems = invByCategory('collector').sort((a, b) => a.name.localeCompare(b.name));
  ['ep_cath_mesh_id', 'ep_anod_mesh_id'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">-- Select mesh from inventory --</option>` +
      meshItems.map(i => {
        const w = i.width_mm ? ` • ${i.width_mm}mm wide` : '';
        const t = i.thickness_mm ? ` • ${i.thickness_mm}mm thick` : '';
        const stock = (i.quantity != null) ? ` — ${i.quantity} ${i.unit}` : '';
        return `<option value="${i.id}">${i.name}${w}${t}${stock}</option>`;
      }).join('');
    if (cur && meshItems.some(i => i.id === cur)) sel.value = cur;
  });

  // Rebuild the mix tables so density/cap snapshots refresh from live inventory
  if (document.getElementById('cathMixBody')) {
    buildMixTable(cathComponents, 'cathMixBody', 'cathMixTotal', 'cathSolidDens', 'cathCompCap', 'cathode');
    buildMixTable(anodComponents, 'anodMixBody', 'anodMixTotal', 'anodSolidDens', 'anodCompCap', 'anode');
  }
  // Re-sync the width readout on each electrode from its current mesh selection
  syncElectrodeWidthFromMesh('cathode');
  syncElectrodeWidthFromMesh('anode');
}

// When a mesh is selected, the electrode inherits its width. Also stamps
// the mesh into elecProps for save/load round-tripping.
function syncElectrodeWidthFromMesh(electrode) {
  const isCath = electrode === 'cathode';
  const sel = document.getElementById(isCath ? 'ep_cath_mesh_id' : 'ep_anod_mesh_id');
  const widthInput = document.getElementById(isCath ? 'ep_cath_width' : 'ep_anod_width');
  const stockEl = document.getElementById(isCath ? 'cathMeshStock' : 'anodMeshStock');
  if (!sel || !widthInput) return;

  const inv = sel.value ? invById(sel.value) : null;
  if (inv) {
    widthInput.value = inv.width_mm || '';
    if (stockEl) {
      stockEl.innerHTML = `<strong>${inv.name}</strong> — ${inv.quantity} ${inv.unit}` +
        (inv.thickness_mm ? ` • ${inv.thickness_mm}mm thick` : '') +
        (inv.color ? ` • <span style="display:inline-block;width:10px;height:10px;background:${inv.color};border:1px solid var(--border);vertical-align:middle"></span>` : '');
    }
    // Stamp into elecProps so save/load carries the link
    if (isCath) {
      elecProps.cath_mesh_inventory_id = inv.id;
      elecProps.cath_width_mm = inv.width_mm || null;
      elecProps.cath_cc_material = inv.name;       // keep name as legacy compat
    } else {
      elecProps.anod_mesh_inventory_id = inv.id;
      elecProps.anod_width_mm = inv.width_mm || null;
      elecProps.anod_cc_material = inv.name;
    }
    // Push the width onto the matching electrode layer so geometry stays in sync
    const layer = layers.find(l => l.type === electrode);
    if (layer && inv.width_mm) layer.w = inv.width_mm;
  } else {
    widthInput.value = '';
    if (stockEl) stockEl.innerHTML = '<em style="color:var(--fg2)">No mesh selected</em>';
  }
}

function updateFormulation(components, totalId, solidDensId, compCapId, electrode) {
  const totalWt = components.reduce((s, c) => s + c.wt, 0);
  const totalEl = document.getElementById(totalId);
  totalEl.textContent = `Total: ${totalWt.toFixed(2)}%`;
  totalEl.className = 'comp-total ' + (Math.abs(totalWt - 100) < 0.1 ? 'ok' : 'err');

  // Resolve density from live inventory (physical property, not a design
  // choice) and capacity from the component itself (design override; seeded
  // from inventory on add, but the user owns it).
  const densOf = c => {
    const inv = c.inventory_item_id ? invById(c.inventory_item_id) : null;
    return inv ? (inv.density || 0) : (c.density || 0);
  };
  const capOf = c => c.cap || 0;   // component is authoritative for capacity

  // Harmonic weighted average solid density
  let densSum = 0;
  components.forEach(c => {
    const d = densOf(c);
    if (c.wt > 0 && d > 0) densSum += (c.wt / 100) / d;
  });
  const solidDens = densSum > 0 ? 1 / densSum : 0;
  document.getElementById(solidDensId).textContent = solidDens.toFixed(3);

  // Composite specific capacity (weighted by every component, active or not —
  // inactive ones typically have cap=0 so they drop out)
  let compCap = 0;
  components.forEach(c => { const k = capOf(c); if (k > 0) compCap += (c.wt / 100) * k; });
  document.getElementById(compCapId).textContent = compCap.toFixed(1);

  // Update elecProps from formulation
  if (electrode === 'cathode') {
    // Find active material wt% and specific capacity
    const activeComps = components.filter(c => c.isActive);
    elecProps.cath_active_wt = activeComps.reduce((s, c) => s + c.wt, 0) / 100;
    elecProps.cath_spec_cap = activeComps.length > 0
      ? activeComps.reduce((s, c) => s + c.wt * c.cap, 0) / activeComps.reduce((s, c) => s + c.wt, 0)
      : 0;
  } else {
    // Anode: Zn and ZnO are both active with different capacities
    const zn = components.find(c => c.name.startsWith('Zinc'));
    const zno = components.find(c => c.name === 'ZnO');
    elecProps.anod_zn_wt = zn ? zn.wt / 100 : 0;
    elecProps.anod_zno_wt = zno ? zno.wt / 100 : 0;
    elecProps.anod_zn_cap = zn ? zn.cap : 820;
    elecProps.anod_zno_cap = zno ? zno.cap : 660;
  }
}

// Build both mix tables on init (called after DOM ready)
function initFormulation() {
  buildMixTable(cathComponents, 'cathMixBody', 'cathMixTotal', 'cathSolidDens', 'cathCompCap', 'cathode');
  buildMixTable(anodComponents, 'anodMixBody', 'anodMixTotal', 'anodSolidDens', 'anodCompCap', 'anode');
  ['design', 'cathode', 'anode', 'layers'].forEach(loadPresetList);
  refreshCompLibDropdowns();
  refreshLayerLibDropdown();

  // Wire mesh select change handlers — picking a mesh auto-syncs the
  // electrode's width readout + elecProps + the matching layer's .w
  ['cathode', 'anode'].forEach(electrode => {
    const selId = electrode === 'cathode' ? 'ep_cath_mesh_id' : 'ep_anod_mesh_id';
    const sel = document.getElementById(selId);
    if (sel && !sel.dataset.wired) {
      sel.addEventListener('change', () => {
        syncElectrodeWidthFromMesh(electrode);
        if (typeof buildLayerUI === 'function') buildLayerUI();
        if (typeof markDirty === 'function') markDirty();
      });
      sel.dataset.wired = '1';
    }
  });

  // Load cloud components if API is configured
  loadCloudCache();
}

// Validate wt% totals before simulation. Returns { ok, msg } — callers
// (e.g. Run Simulation) should block if ok=false and toast the msg.
function validateMixTotals() {
  const issues = [];
  [['cathode', cathComponents], ['anode', anodComponents]].forEach(([label, comps]) => {
    if (!comps.length) return;    // empty mix is its own category of problem, not a wt% one
    const total = comps.reduce((s, c) => s + (c.wt || 0), 0);
    if (Math.abs(total - 100) > 0.5) {
      issues.push(`${label} wt% = ${total.toFixed(2)} (must be 99.5 – 100.5)`);
    }
  });
  return { ok: issues.length === 0, msg: issues.join(' • ') };
}

// ========== LIBRARIES (backed by cloud tables) ==========
// Components come from the `chemicals` table (density + capacity).
// Layers come from the `materials` table (type + thickness + width + color).
// These are fetched once at startup into cloudChemicals / cloudMaterials
// and refreshed via the same paths.

function getCompLib() {
  // name → {density, cap, id}
  const lib = {};
  cloudChemicals.forEach(c => {
    lib[c.name] = { density: c.density, cap: c.capacity || 0, id: c.id };
  });
  return lib;
}
function getLayerLib() {
  // name → {type, t, w, color, id}
  const lib = {};
  cloudMaterials.forEach(m => {
    lib[m.name] = { type: m.type, t: m.thickness, w: m.width, color: m.color || '#888', id: m.id };
  });
  return lib;
}

async function saveCompToLib(comp) {
  const name = prompt('Save chemical as:', comp.name);
  if (!name) return;
  if (!isApiConfigured()) { showToast('API not configured', true); return; }
  try {
    const existing = cloudChemicals.find(c => c.name === name);
    const payload = {
      name,
      density: comp.density,
      capacity: comp.cap || 0,
      is_active_mat: (comp.cap || 0) > 0,
    };
    let saved;
    if (existing) {
      saved = await api.updateChemical(existing.id, payload);
      Object.assign(existing, saved);
    } else {
      saved = await api.createChemical(payload);
      cloudChemicals.push(saved);
    }
    refreshCompLibDropdowns();
    showToast(`Saved chemical: ${name}`);
  } catch(e) { showToast('Save failed: ' + e.message, true); console.error(e); }
}

async function saveLayerToLib(layer) {
  const name = prompt('Save material as:', layer.name);
  if (!name) return;
  if (!isApiConfigured()) { showToast('API not configured', true); return; }
  try {
    const existing = cloudMaterials.find(m => m.name === name);
    // The materials table only allows separator/tape/collector/other.
    // Map cathode/anode layer types to 'other' so the UI can still save
    // electrode-shaped layer templates.
    const mType = ['separator','tape','collector','other'].includes(layer.type) ? layer.type : 'other';
    const payload = {
      name,
      type: mType,
      thickness: layer.t,
      width: layer.w,
      color: layer.color || '#888',
    };
    let saved;
    if (existing) {
      saved = await api.updateMaterial(existing.id, payload);
      Object.assign(existing, saved);
    } else {
      saved = await api.createMaterial(payload);
      cloudMaterials.push(saved);
    }
    refreshLayerLibDropdown();
    showToast(`Saved material: ${name}`);
  } catch(e) { showToast('Save failed: ' + e.message, true); console.error(e); }
}

function refreshCompLibDropdowns() {
  const lib = getCompLib();
  ['cathCompLib', 'anodCompLib'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    Object.keys(lib).sort().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${name} (${lib[name].density} g/cm³${lib[name].cap ? ', ' + lib[name].cap + ' mAh/g' : ''})`;
      sel.appendChild(opt);
    });
  });
}

function refreshLayerLibDropdown() {
  const lib = getLayerLib();
  const sel = document.getElementById('layerLib');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  Object.keys(lib).sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${lib[name].type}, ${lib[name].t}mm)`;
    sel.appendChild(opt);
  });
}

function addCompFromLib(electrode) {
  const selId = electrode === 'cathode' ? 'cathCompLib' : 'anodCompLib';
  const sel = document.getElementById(selId);
  const name = sel.value;
  if (!name) { showToast('Select a chemical from the library', true); return; }
  const lib = getCompLib();
  const c = lib[name];
  if (!c) return;
  const comps = electrode === 'cathode' ? cathComponents : anodComponents;
  comps.push({ name, wt: 0, density: c.density, cap: c.cap });
  const [bodyId, totalId, solidDensId, compCapId] = electrode === 'cathode'
    ? ['cathMixBody', 'cathMixTotal', 'cathSolidDens', 'cathCompCap']
    : ['anodMixBody', 'anodMixTotal', 'anodSolidDens', 'anodCompCap'];
  buildMixTable(comps, bodyId, totalId, solidDensId, compCapId, electrode);
  sel.value = '';
  markDirty();
}

function addBlankComp(electrode) {
  const comps = electrode === 'cathode' ? cathComponents : anodComponents;
  comps.push({ name: 'New Component', wt: 0, density: 1.0, cap: 0 });
  const [bodyId, totalId, solidDensId, compCapId] = electrode === 'cathode'
    ? ['cathMixBody', 'cathMixTotal', 'cathSolidDens', 'cathCompCap']
    : ['anodMixBody', 'anodMixTotal', 'anodSolidDens', 'anodCompCap'];
  buildMixTable(comps, bodyId, totalId, solidDensId, compCapId, electrode);
  markDirty();
}

function addLayerFromLib() {
  const sel = document.getElementById('layerLib');
  const name = sel.value;
  if (!name) { showToast('Select a material from the library', true); return; }
  const lib = getLayerLib();
  const l = lib[name];
  if (!l) return;
  layers.push({ name, type: l.type, t: l.t, w: l.w, color: l.color });
  buildLayerUI();
  sel.value = '';
  markDirty();
}

