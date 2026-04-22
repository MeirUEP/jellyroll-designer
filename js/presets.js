// ========== PRESET SYSTEM (cloud-only) ==========
// 4 independent preset types: design (full), cathode, anode, layers
const PRESET_SELECTS = {
  design:  'designPreset',
  cathode: 'cathPreset',
  anode:   'anodPreset',
  layers:  'layerPreset',
};

// In-memory preset stores — populated from cloud on load
const presetStores = { cathode: {}, anode: {}, layers: {}, design: {} };

function getPresets(type) { return presetStores[type]; }

function loadPresetList(type) {
  const sel = document.getElementById(PRESET_SELECTS[type]);
  const presets = getPresets(type);
  while (sel.options.length > 1) sel.remove(1);
  Object.keys(presets).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name.replace('☁ ', '');
    sel.appendChild(opt);
  });
}

// --- Get current state for each type ---
function getCathodePreset() {
  return {
    components: cathComponents.map(c => ({ ...c })),
    bulk_density: elecProps.cath_bulk_density,
    thickness: elecProps.cath_thickness,
    mesh_dens: elecProps.cath_mesh_dens,
    cc_material: elecProps.cath_cc_material || null,
  };
}
function getAnodePreset() {
  return {
    components: anodComponents.map(c => ({ ...c })),
    bulk_density: elecProps.anod_bulk_density,
    thickness: elecProps.anod_thickness,
    mesh_dens: elecProps.anod_mesh_dens,
    cc_material: elecProps.anod_cc_material || null,
  };
}
function getLayersPreset() {
  return { layers: layers.map(l => ({ ...l })) };
}
// Cell Parameters preset: only the values in the Cell Parameters tab.
// For full design (cell params + layers + formulations + sim result) use
// the header "Save Design" button (btnCloudSave).
function getDesignPreset() {
  return { params: { ...params } };
}

// --- Apply presets ---
// Restore the mesh dropdown selection for an electrode. cc_material is
// stored as the mesh name; we find the matching inventory item (category
// = collector) and set the dropdown value. syncElectrodeWidthFromMesh()
// then stamps width, linear density, and cc_material onto elecProps so
// the loaded mix is fully reconstituted from inventory.
function restoreMeshSelection(electrode, meshName) {
  if (!meshName) return;
  const selId = electrode === 'cathode' ? 'ep_cath_mesh_id' : 'ep_anod_mesh_id';
  const sel = document.getElementById(selId);
  if (!sel) return;
  // Find the inventory item by name (case-insensitive) in the collector category
  const inv = invByCategory('collector').find(i =>
    (i.name || '').trim().toLowerCase() === meshName.trim().toLowerCase()
  );
  if (!inv) {
    showToast(`Mesh "${meshName}" not found in inventory — add it or pick manually`, true);
    return;
  }
  sel.value = inv.id;
  // Fires syncElectrodeWidthFromMesh via the 'change' listener wired in initFormulation
  sel.dispatchEvent(new Event('change'));
}

// Push the formulation's width/thickness onto every matching electrode
// layer so the layer UI, geometry rendering, and PDF export stay in
// sync with the loaded formulation. Called after applying a preset and
// whenever the mesh or thickness changes.
function syncElectrodeLayersFromFormulation(electrode) {
  const w = electrode === 'cathode' ? elecProps.cath_width_mm : elecProps.anod_width_mm;
  const t = electrode === 'cathode' ? elecProps.cath_thickness : elecProps.anod_thickness;
  let changed = false;
  layers.forEach(l => {
    if (l.type !== electrode) return;
    if (w && l.w !== w) { l.w = w; changed = true; }
    if (t && l.t !== t) { l.t = t; changed = true; }
  });
  if (changed && typeof buildLayerUI === 'function') buildLayerUI();
}

function applyCathodePreset(p) {
  cathComponents.length = 0;
  p.components.forEach(c => cathComponents.push({ ...c }));
  if (p.bulk_density !== undefined) { elecProps.cath_bulk_density = p.bulk_density; document.getElementById('ep_cath_bulk_density').value = p.bulk_density; }
  if (p.thickness !== undefined && p.thickness !== null) { elecProps.cath_thickness = p.thickness; document.getElementById('ep_cath_thickness').value = p.thickness; }
  if (p.mesh_dens !== undefined) { elecProps.cath_mesh_dens = p.mesh_dens; document.getElementById('ep_cath_mesh_dens').value = p.mesh_dens; }
  if (p.cc_material) { elecProps.cath_cc_material = p.cc_material; restoreMeshSelection('cathode', p.cc_material); }
  buildMixTable(cathComponents, 'cathMixBody', 'cathMixTotal', 'cathSolidDens', 'cathCompCap', 'cathode');
  syncElectrodeLayersFromFormulation('cathode');
  markDirty();
}
function applyAnodePreset(p) {
  anodComponents.length = 0;
  p.components.forEach(c => anodComponents.push({ ...c }));
  if (p.bulk_density !== undefined) { elecProps.anod_bulk_density = p.bulk_density; document.getElementById('ep_anod_bulk_density').value = p.bulk_density; }
  if (p.thickness !== undefined && p.thickness !== null) { elecProps.anod_thickness = p.thickness; document.getElementById('ep_anod_thickness').value = p.thickness; }
  if (p.mesh_dens !== undefined) { elecProps.anod_mesh_dens = p.mesh_dens; document.getElementById('ep_anod_mesh_dens').value = p.mesh_dens; }
  if (p.cc_material) { elecProps.anod_cc_material = p.cc_material; restoreMeshSelection('anode', p.cc_material); }
  buildMixTable(anodComponents, 'anodMixBody', 'anodMixTotal', 'anodSolidDens', 'anodCompCap', 'anode');
  syncElectrodeLayersFromFormulation('anode');
  markDirty();
}
function applyLayersPreset(p) {
  const src = p.layers || p;
  if (!Array.isArray(src) || src.length === 0) return;
  layers.length = 0;
  src.forEach(l => { const ll = { ...l }; delete ll.startTurn; layers.push(ll); });
  // Auto-link any legacy orphans by name back to inventory/mix, then
  // re-sync electrode geometry from the currently loaded formulation.
  if (typeof hydrateLayerSnapshots === 'function') hydrateLayerSnapshots();
  if (typeof syncElectrodeLayersFromFormulation === 'function') {
    syncElectrodeLayersFromFormulation('cathode');
    syncElectrodeLayersFromFormulation('anode');
  }
  buildLayerUI();
  markDirty();
}
function applyDesignPreset(p) {
  // Cell Parameters preset — tolerate both old full-design shape and new
  // params-only shape for backward compat.
  const src = p.params || p;
  if (!src || typeof src !== 'object') return;
  Object.assign(params, src);
  for (const [k, v] of Object.entries(params)) {
    const el = document.getElementById('p_' + k);
    if (el) el.value = v;
  }
  markDirty();
}

// --- Unified preset button handlers ---
const PRESET_GETTERS = { design: getDesignPreset, cathode: getCathodePreset, anode: getAnodePreset, layers: getLayersPreset };
const PRESET_APPLIERS = { design: applyDesignPreset, cathode: applyCathodePreset, anode: applyAnodePreset, layers: applyLayersPreset };
const PRESET_LABELS = { design: 'cell parameters', cathode: 'cathode formulation', anode: 'anode formulation', layers: 'layer stack' };

document.querySelectorAll('.preset-load').forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.presetType;
    const sel = document.getElementById(PRESET_SELECTS[type]);
    const name = sel.value;
    if (!name) { showToast('Select a preset first', true); return; }
    const presets = getPresets(type);
    const entry = presets[name];
    if (!entry) return;
    // Cloud preset: fetch from API and convert
    if (entry._cloud && isApiConfigured()) {
      try {
        if (type === 'cathode' || type === 'anode') {
          const mix = await api.getMix(entry._cloudId);
          PRESET_APPLIERS[type](mixFromApi(mix));
        } else if (type === 'layers') {
          const stack = await api.getLayerStack(entry._cloudId);
          const layersArr = layerStackFromApi(stack);
          applyLayersPreset({ layers: layersArr });
        } else if (type === 'design') {
          // Cell Parameters preset (cloud)
          const preset = await api.getCellParamPreset(entry._cloudId);
          // Keep the cached entry in sync with the fresh fetch
          presetStores.design[name] = { _cloudId: preset.id, _cloud: true, params: preset.params };
          applyDesignPreset({ params: preset.params });
        }
        showToast(`Loaded ${PRESET_LABELS[type]}: ${name.replace('☁ ', '')}`);
      } catch(e) { showToast('Cloud load failed: ' + e.message, true); }
    } else {
      PRESET_APPLIERS[type](entry);
      showToast(`Loaded ${PRESET_LABELS[type]}: ${name}`);
    }
  });
});

document.querySelectorAll('.preset-save').forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.presetType;
    const sel = document.getElementById(PRESET_SELECTS[type]);
    const rawName = sel.value ? sel.value.replace('☁ ', '') : '';
    const name = prompt(`Save ${PRESET_LABELS[type]} as:`, rawName);
    if (!name) return;
    if (!isApiConfigured()) { showToast('API not configured — cannot save', true); return; }
    // Save to cloud
    if (type === 'cathode' || type === 'anode' || type === 'layers') {
      try {
        if (type === 'cathode' || type === 'anode') {
          const payload = mixToApi(PRESET_GETTERS[type](), type);
          payload.name = name;
          // Check if updating existing cloud mix
          const existing = cloudMixes.find(m => m.name === name && m.type === type);
          let saved;
          if (existing) {
            saved = await api.updateMix(existing.id, payload);
            Object.assign(existing, saved);
          } else {
            saved = await api.createMix(payload);
            cloudMixes.push(saved);
          }
          presetStores[type]['☁ ' + name] = { _cloudId: saved.id, _cloud: true };
          // New/updated mix appears in the add-layer dropdown immediately
          if (typeof refreshLayerAddDropdowns === 'function') refreshLayerAddDropdowns();
        } else if (type === 'layers') {
          const payload = await layerStackToApi(layers);
          payload.name = name;
          const existing = cloudLayerStacks.find(s => s.name === name);
          let saved;
          if (existing) {
            saved = await api.updateLayerStack(existing.id, payload);
            Object.assign(existing, saved);
          } else {
            saved = await api.createLayerStack(payload);
            cloudLayerStacks.push(saved);
          }
          presetStores.layers['☁ ' + name] = { _cloudId: saved.id, _cloud: true };
        }
        showToast(`Saved to cloud: ${name}`);
        // Remove local-only entry so only cloud version shows
        delete presetStores[type][name];
        loadPresetList(type);
        sel.value = '☁ ' + name;
      } catch(e) { showToast('Cloud save failed: ' + e.message, true); console.error(e); }
    } else if (type === 'design') {
      // Cell Parameters preset — save ONLY the Cell Parameters tab values to
      // the cloud. For full design saves use the header "Save Design" button.
      try {
        const payload = { name, params: { ...params } };
        // Check for existing cloud preset with this name to update in place
        const existingKey = '☁ ' + name;
        const existing = presetStores.design[existingKey];
        let saved;
        if (existing && existing._cloud && existing._cloudId) {
          saved = await api.updateCellParamPreset(existing._cloudId, payload);
        } else {
          saved = await api.createCellParamPreset(payload);
        }
        presetStores.design[existingKey] = { _cloudId: saved.id, _cloud: true, params: saved.params };
        // Remove any local-only entry with the same bare name
        delete presetStores.design[name];
        loadPresetList('design');
        sel.value = existingKey;
        showToast(`Saved cell parameters: ${name}`);
      } catch(e) { showToast('Cloud save failed: ' + e.message, true); console.error(e); }
    }
  });
});

document.querySelectorAll('.preset-del').forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.presetType;
    const sel = document.getElementById(PRESET_SELECTS[type]);
    const name = sel.value;
    if (!name) { showToast('Select a preset first', true); return; }
    if (!confirm(`Delete "${name.replace('☁ ', '')}"?`)) return;
    const entry = presetStores[type][name];
    if (!isApiConfigured()) { showToast('API not configured', true); return; }
    if (entry && entry._cloud) {
      try {
        if (type === 'cathode' || type === 'anode') {
          await api.deleteMix(entry._cloudId);
          cloudMixes = cloudMixes.filter(m => m.id !== entry._cloudId);
          if (typeof refreshLayerAddDropdowns === 'function') refreshLayerAddDropdowns();
          // Layers that pointed at this mix are now orphans — re-render so
          // the amber banner appears.
          if (typeof hydrateLayerSnapshots === 'function') hydrateLayerSnapshots();
          if (typeof buildLayerUI === 'function') buildLayerUI();
        } else if (type === 'layers') {
          await api.deleteLayerStack(entry._cloudId);
          cloudLayerStacks = cloudLayerStacks.filter(s => s.id !== entry._cloudId);
        } else if (type === 'design') {
          await api.deleteCellParamPreset(entry._cloudId);
        }
        delete presetStores[type][name];
        loadPresetList(type);
        showToast(`Deleted: ${name.replace('☁ ', '')}`);
      } catch(e) { showToast('Cloud delete failed: ' + e.message, true); }
    }
  });
});

// Bottom section toggle
document.getElementById('bottomToggle').addEventListener('click', () => {
  const bs = document.getElementById('bottomSection');
  bs.classList.toggle('collapsed');
  const icon = bs.classList.contains('collapsed') ? '&#9650;' : '&#9660;';
  document.getElementById('bottomToggle').innerHTML = icon + ' Summary &amp; Tab Positions';
  setTimeout(() => renderView(), 50);
});

// ========== STATE ==========
