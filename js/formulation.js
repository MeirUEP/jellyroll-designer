// ========== LEFT PANEL TABS ==========
document.querySelectorAll('.left-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.left-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.left-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('ltab-' + btn.dataset.ltab).classList.add('active');
  });
});

// ========== FORMULATION ENGINE ==========
const cathComponents = [
  { name: 'EMD (MnO2)', wt: 75, density: 4.5, cap: 250, isActive: true },
  { name: 'Graphite (MX-25)', wt: 15.75, density: 2.25, cap: 0 },
  { name: 'Carbon Black (BNB-90)', wt: 2.25, density: 1.8, cap: 0 },
  { name: 'PTFE', wt: 2, density: 2.15, cap: 0 },
  { name: 'Bi2O3', wt: 4, density: 8.9, cap: 0 },
  { name: 'ZrO2', wt: 1, density: 5.68, cap: 0 },
  { name: 'Other', wt: 0, density: 3, cap: 0 },
];

const anodComponents = [
  { name: 'Zinc (Zn)', wt: 75, density: 7.14, cap: 820, isActive: true },
  { name: 'ZnO', wt: 16, density: 5.61, cap: 660, isActive: true },
  { name: 'Ca(OH)2', wt: 5, density: 2.24, cap: 0 },
  { name: 'Bi2O3', wt: 2, density: 8.9, cap: 0 },
  { name: 'Laponite', wt: 0.01, density: 2.53, cap: 0 },
  { name: 'PTFE', wt: 2, density: 2.15, cap: 0 },
  { name: 'In(OH)3', wt: 0.037, density: 4.39, cap: 0 },
  { name: 'Other', wt: 0, density: 3, cap: 0 },
];

function buildMixTable(components, bodyId, totalId, solidDensId, compCapId, electrode) {
  const body = document.getElementById(bodyId);
  body.innerHTML = '';
  components.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${c.name}" data-ci="${i}" data-field="name" style="width:90px;font-size:9px;border:1px solid var(--border);border-radius:2px;background:var(--input-bg);color:var(--fg);padding:1px 2px"></td>
      <td><input type="number" step="0.01" value="${c.wt}" data-ci="${i}" data-field="wt" style="width:50px"></td>
      <td><input type="number" step="0.01" value="${c.density}" data-ci="${i}" data-field="density" style="width:50px"></td>
      <td><input type="number" step="1" value="${c.cap}" data-ci="${i}" data-field="cap" style="width:50px"></td>
      <td style="white-space:nowrap">
        <button class="btn-sm" data-save-comp="${i}" data-electrode="${electrode}" title="Save to library" style="padding:1px 3px;font-size:8px">&#128190;</button>
        <button class="btn-sm" data-del-comp="${i}" data-electrode="${electrode}" title="Remove" style="padding:1px 3px;font-size:8px;background:var(--red);color:#fff">&times;</button>
      </td>`;
    body.appendChild(tr);
  });

  body.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', e => {
      const ci = +e.target.dataset.ci;
      const field = e.target.dataset.field;
      if (field === 'name') components[ci][field] = e.target.value;
      else components[ci][field] = +e.target.value;
      updateFormulation(components, totalId, solidDensId, compCapId, electrode);
      markDirty();
    });
  });

  // Save component to library
  body.querySelectorAll('[data-save-comp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ci = +btn.dataset.saveComp;
      const c = components[ci];
      saveCompToLib(c);
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

function updateFormulation(components, totalId, solidDensId, compCapId, electrode) {
  const totalWt = components.reduce((s, c) => s + c.wt, 0);
  const totalEl = document.getElementById(totalId);
  totalEl.textContent = `Total: ${totalWt.toFixed(2)}%`;
  totalEl.className = 'comp-total ' + (Math.abs(totalWt - 100) < 0.1 ? 'ok' : 'err');

  // Harmonic weighted average solid density
  let densSum = 0;
  components.forEach(c => { if (c.wt > 0 && c.density > 0) densSum += (c.wt / 100) / c.density; });
  const solidDens = densSum > 0 ? 1 / densSum : 0;
  document.getElementById(solidDensId).textContent = solidDens.toFixed(3);

  // Composite specific capacity (weighted by active components)
  let compCap = 0;
  components.forEach(c => { if (c.cap > 0) compCap += (c.wt / 100) * c.cap; });
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
  // Load cloud components if API is configured
  loadCloudCache();
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

