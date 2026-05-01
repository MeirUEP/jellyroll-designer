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
// inventory record that defines density. Capacity is a per-design property — only wt%
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
    // Capacity is a per-design property — owned by the mix component,
    // not by inventory. Default is 0; user enters the value once per mix.
    const capVal = c.cap != null ? c.cap : 0;
    const capTooltip = 'Specific capacity (mAh/g) for this design';
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
    cap: 0,  // capacity is a design property — user enters per-mix
    isActive: false,  // active flag is no longer an inventory property; kept on the mix component for legacy schema compat
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
        const activeTag = '';  // active flag removed from inventory items
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
  // Refresh the layer-stack add dropdowns and re-hydrate linked layers
  if (typeof refreshLayerAddDropdowns === 'function') refreshLayerAddDropdowns();
  if (typeof hydrateLayerSnapshots === 'function') {
    hydrateLayerSnapshots();
    if (typeof buildLayerUI === 'function') buildLayerUI();
  }
}

// When a mesh is selected, the electrode inherits its width. Also stamps
// the mesh into elecProps for save/load round-tripping.
function syncElectrodeWidthFromMesh(electrode) {
  const isCath = electrode === 'cathode';
  const sel = document.getElementById(isCath ? 'ep_cath_mesh_id' : 'ep_anod_mesh_id');
  const widthInput = document.getElementById(isCath ? 'ep_cath_width' : 'ep_anod_width');
  const meshDensInput = document.getElementById(isCath ? 'ep_cath_mesh_dens' : 'ep_anod_mesh_dens');
  const stockEl = document.getElementById(isCath ? 'cathMeshStock' : 'anodMeshStock');
  if (!sel || !widthInput) return;

  const inv = sel.value ? invById(sel.value) : null;
  if (inv) {
    widthInput.value = inv.width_mm || '';
    // Mesh linear density — physical property, read from inventory
    if (meshDensInput && inv.density != null) {
      meshDensInput.value = inv.density;
      meshDensInput.readOnly = true;
      meshDensInput.style.background = 'var(--bg-secondary, #2a2a2a)';
      meshDensInput.title = 'From inventory — edit in Inventory modal';
      elecProps[isCath ? 'cath_mesh_dens' : 'anod_mesh_dens'] = inv.density;
    }
    if (stockEl) {
      stockEl.innerHTML = `<strong>${inv.name}</strong> — ${inv.quantity} ${inv.unit}` +
        (inv.thickness_mm ? ` • ${inv.thickness_mm}mm thick` : '') +
        (inv.density ? ` • ${inv.density} g/in²` : '') +
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
    // Restore mesh density input to editable when no mesh selected
    if (meshDensInput) {
      meshDensInput.readOnly = false;
      meshDensInput.style.background = '';
      meshDensInput.title = '';
    }
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

  // Composite specific capacity — just sum(wt% × cap). Inactive components
  // naturally have cap=0 so they drop out. No "active material" flag needed.
  // This is the single source of truth for electrode capacity (mAh/g).
  let compCap = 0;
  components.forEach(c => { const k = capOf(c); if (k > 0) compCap += (c.wt / 100) * k; });
  document.getElementById(compCapId).textContent = compCap.toFixed(1);

  // Stamp composite capacity onto elecProps for the capacity calculator.
  if (electrode === 'cathode') {
    elecProps.cath_composite_cap = compCap;
  } else {
    elecProps.anod_composite_cap = compCap;
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
        // Width changed → push onto matching layer(s) and re-render stack
        if (typeof syncElectrodeLayersFromFormulation === 'function') {
          syncElectrodeLayersFromFormulation(electrode);
        } else if (typeof buildLayerUI === 'function') {
          buildLayerUI();
        }
        if (typeof markDirty === 'function') markDirty();
      });
      sel.dataset.wired = '1';
    }
  });

  // Wire thickness + bulk density inputs — manual edits need to stamp
  // onto elecProps and then propagate to the matching electrode layer so
  // capacity, geometry, and PDF exports stay consistent.
  [
    { id: 'ep_cath_thickness',    prop: 'cath_thickness',    electrode: 'cathode', syncLayer: true  },
    { id: 'ep_anod_thickness',    prop: 'anod_thickness',    electrode: 'anode',   syncLayer: true  },
    { id: 'ep_cath_bulk_density', prop: 'cath_bulk_density', electrode: 'cathode', syncLayer: false },
    { id: 'ep_anod_bulk_density', prop: 'anod_bulk_density', electrode: 'anode',   syncLayer: false },
    { id: 'ep_cath_mesh_dens',    prop: 'cath_mesh_dens',    electrode: 'cathode', syncLayer: false },
    { id: 'ep_anod_mesh_dens',    prop: 'anod_mesh_dens',    electrode: 'anode',   syncLayer: false },
  ].forEach(({ id, prop, electrode, syncLayer }) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.wired) return;
    el.addEventListener('change', () => {
      const v = parseFloat(el.value);
      if (!isNaN(v)) elecProps[prop] = v;
      if (syncLayer && typeof syncElectrodeLayersFromFormulation === 'function') {
        syncElectrodeLayersFromFormulation(electrode);
      }
      if (typeof markDirty === 'function') markDirty();
    });
    el.dataset.wired = '1';
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

// refreshLayerLibDropdown kept as a no-op so legacy callers don't throw.
// The layer-library dropdown was replaced by the two inventory/mix dropdowns
// — see refreshLayerAddDropdowns() below.
function refreshLayerLibDropdown() { /* deprecated — no-op */ }

// ========== LAYER ADD FLOW (inventory + mix dropdowns) ==========
// Two dropdowns drive every layer add:
//   1. addLayerMix  — saved electrode mixes from cloudMixes (cathode / anode).
//                     The mesh lives inside the mix, not as a separate layer.
//   2. addLayerInv  — inventory items filtered by "layerable" categories
//                     (separator, other). Meshes (collector), tabs, and
//                     tape are tracked in inventory but aren't wound layers:
//                       • mesh belongs to the cathode/anode design
//                       • tab and tape are cell-assembly components
// A layer added this way carries either `mix_id` or `inventory_item_id` so
// save/load round-trips the link; name/thickness/width/color are stamped
// as a snapshot from the source, and re-hydrated on every refresh so edits
// to inventory flow through without breaking the design.

const LAYERABLE_INV_CATEGORIES = ['separator', 'other'];

function addLayerFromMix() {
  const sel = document.getElementById('addLayerMix');
  const mixId = sel.value;
  if (!mixId) return;
  const mix = cloudMixes.find(m => m.id === mixId);
  if (!mix) { showToast('Mix not found', true); sel.value = ''; return; }
  // Electrode layer: width comes from the mesh stamped on elecProps
  // (set by the mesh dropdown in the Formulation tab).
  const widthFromMesh = mix.type === 'cathode'
    ? (elecProps.cath_width_mm || 220)
    : (elecProps.anod_width_mm || 220);
  const color = mix.type === 'cathode' ? '#3b82f6' : '#16a34a';
  // Thickness comes from the mix (electrode design property); fall back to
  // the current elecProps thickness for this electrode type.
  const thickness = mix.thickness
    || (mix.type === 'cathode' ? elecProps.cath_thickness : elecProps.anod_thickness)
    || 1.0;
  layers.push({
    mix_id: mixId,
    name: mix.name,
    type: mix.type,         // 'cathode' or 'anode'
    t: thickness,
    w: widthFromMesh,
    color,
  });
  buildLayerUI();
  sel.value = '';
  markDirty();
}

function addLayerFromInventory() {
  const sel = document.getElementById('addLayerInv');
  const invId = sel.value;
  if (!invId) return;
  const inv = invById(invId);
  if (!inv) { showToast('Inventory item not found', true); sel.value = ''; return; }
  layers.push({
    inventory_item_id: invId,
    name: inv.name,
    type: inv.category,                     // 'separator' | 'other'
    t: inv.thickness_mm || 0.1,
    w: inv.width_mm || 220,
    color: inv.color || '#888888',
    // 'other' layers have a fixed length (glue strip, primer, etc.);
    // 'separator' is phase-driven (computed length).
    ...(inv.category === 'separator' ? {} : { len: 0 }),
  });
  buildLayerUI();
  sel.value = '';
  markDirty();
}

// Populate the two add-dropdowns from cloudMixes + cloudInventory.
// Called from refreshFormulationFromInventory() and refreshCloudPresets().
function refreshLayerAddDropdowns() {
  // Mix dropdown — cathode mixes first, then anode
  const mixSel = document.getElementById('addLayerMix');
  if (mixSel) {
    const cur = mixSel.value;
    const cathMixes = cloudMixes.filter(m => m.type === 'cathode').sort((a, b) => a.name.localeCompare(b.name));
    const anodMixes = cloudMixes.filter(m => m.type === 'anode').sort((a, b) => a.name.localeCompare(b.name));
    let html = `<option value="">+ Add electrode from saved mixes...</option>`;
    if (cathMixes.length) {
      html += `<optgroup label="Cathode mixes">` +
        cathMixes.map(m => `<option value="${m.id}">${m.name}</option>`).join('') +
        `</optgroup>`;
    }
    if (anodMixes.length) {
      html += `<optgroup label="Anode mixes">` +
        anodMixes.map(m => `<option value="${m.id}">${m.name}</option>`).join('') +
        `</optgroup>`;
    }
    mixSel.innerHTML = html;
    mixSel.value = cur;
  }

  // Inventory dropdown — layerable categories only, grouped by category
  const invSel = document.getElementById('addLayerInv');
  if (invSel) {
    const cur = invSel.value;
    let html = `<option value="">+ Add separator / other layer from inventory...</option>`;
    LAYERABLE_INV_CATEGORIES.forEach(cat => {
      const items = invByCategory(cat).sort((a, b) => a.name.localeCompare(b.name));
      if (!items.length) return;
      html += `<optgroup label="${cat}">` +
        items.map(i => {
          const spec = [
            i.thickness_mm ? `${i.thickness_mm}mm thick` : null,
            i.width_mm ? `${i.width_mm}mm wide` : null,
          ].filter(Boolean).join(', ');
          const specTag = spec ? ` (${spec})` : '';
          const stockTag = (i.quantity != null) ? ` — ${i.quantity} ${i.unit}` : '';
          return `<option value="${i.id}">${i.name}${specTag}${stockTag}</option>`;
        }).join('') +
        `</optgroup>`;
    });
    invSel.innerHTML = html;
    invSel.value = cur;
  }
}

// Re-hydrate each linked layer's snapshot (name/t/w/color) from its live
// inventory or mix source. Legacy layers with no link but a recognizable
// name are auto-linked back to inventory/mix, recovering orphans saved
// before layer stacks carried inventory_item_id/mix_id.
function hydrateLayerSnapshots() {
  layers.forEach(l => {
    // Auto-link by name for legacy orphans (no IDs) so stacks saved
    // before we started storing links still load fully hydrated.
    if (!l.inventory_item_id && !l.mix_id && l.name) {
      const isElectrode = l.type === 'cathode' || l.type === 'anode';
      if (isElectrode) {
        const mix = cloudMixes.find(m =>
          (m.name || '').trim().toLowerCase() === l.name.trim().toLowerCase() &&
          m.type === l.type
        );
        if (mix) l.mix_id = mix.id;
      } else {
        const inv = invByName(l.name);
        if (inv) l.inventory_item_id = inv.id;
      }
    }

    if (l.inventory_item_id) {
      const inv = invById(l.inventory_item_id);
      if (inv) {
        l.name = inv.name;
        if (inv.thickness_mm) l.t = inv.thickness_mm;
        if (inv.width_mm) l.w = inv.width_mm;
        if (inv.color) l.color = inv.color;
        l.type = inv.category;
      }
    } else if (l.mix_id) {
      const mix = cloudMixes.find(m => m.id === l.mix_id);
      if (mix) {
        l.name = mix.name;
        l.type = mix.type;   // normalize
        // Width is always the current mesh width for this electrode type
        if (mix.type === 'cathode' && elecProps.cath_width_mm) l.w = elecProps.cath_width_mm;
        if (mix.type === 'anode' && elecProps.anod_width_mm) l.w = elecProps.anod_width_mm;
      }
    }
  });
}

