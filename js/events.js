document.getElementById('btnExport').addEventListener('click', () => {
  if (!simResult) return;
  const s = simResult;
  let csv = 'Type,Tab#,Turn,Radius_mm,Pitch_mm,ArcLen_mm,Spacing_mm,Angle_deg\n';
  s.cTabs.forEach(t => {
    csv += `Cathode,${t.idx},${t.turn},${t.r.toFixed(3)},${t.pitch.toFixed(2)},${t.arcLen.toFixed(1)},${t.spacing ? t.spacing.toFixed(1) : '—'},${s.drillAngleDeg.toFixed(1)}\n`;
  });
  s.aTabs.forEach(t => {
    csv += `Anode,${t.idx},${t.turn},${t.r.toFixed(3)},${t.pitch.toFixed(2)},${t.arcLen.toFixed(1)},${t.spacing ? t.spacing.toFixed(1) : '—'},${s.anodAngleDeg.toFixed(1)}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jellyroll-tabs-${Date.now()}.csv`;
  a.click();
});

// Local-file Save/Load was removed — cloud Save Design / Open is the single
// source of truth now (designs live alongside inventory in the DB).

// ========== RESIZE ==========
window.addEventListener('resize', () => {
  if (simResult && currentView !== '3d') renderView();
});

// ========== RUN BUTTON ==========
document.getElementById('btnRun').addEventListener('click', runSimulation);

// ========== PDF EXPORT ==========
document.getElementById('btnPDF').addEventListener('click', () => {
  if (!simResult) return;
  const s = simResult;

  // Capture all 4 views as images
  const origView = currentView;
  const canvas = document.getElementById('mainCanvas');
  const views = ['side','top','unroll'];
  const images = {};

  views.forEach(v => {
    currentView = v;
    document.getElementById('mainCanvas').style.display = '';
    document.getElementById('threeContainer').style.display = 'none';
    renderView();
    images[v] = canvas.toDataURL('image/png');
  });

  // 3D — capture from Three.js renderer
  currentView = '3d';
  if (threeInited) {
    update3DScene();
    threeRenderer.render(threeScene, threeCamera);
    images['3d'] = threeRenderer.domElement.toDataURL('image/png');
  }

  // Restore original view
  currentView = origView;
  document.getElementById('mainCanvas').style.display = currentView === '3d' ? 'none' : '';
  document.getElementById('threeContainer').style.display = currentView === '3d' ? '' : 'none';
  renderView();

  // Build layer stack table
  let layerRows = layers.map((l,i) => `<tr><td>${i}</td><td><span style="display:inline-block;width:12px;height:12px;background:${l.color};border-radius:2px;vertical-align:middle"></span> ${l.name}</td><td>${l.type}</td><td>${l.t}</td><td>${l.w}</td><td>${Math.round(layerLen(l))}</td><td>${(l.off||0).toFixed(1)}</td></tr>`).join('');

  // Build tab table
  let tabRows = '';
  const maxT = Math.max(s.cTabs.length, s.aTabs.length);
  for (let i = 0; i < maxT; i++) {
    if (i < s.cTabs.length) { const t = s.cTabs[i]; tabRows += `<tr><td style="color:#3b82f6">Cathode</td><td>${t.idx}</td><td>${t.turn}</td><td>${t.r.toFixed(2)}</td><td>${t.pitch.toFixed(2)}</td><td>${t.arcLen.toFixed(1)}</td><td>${t.spacing?t.spacing.toFixed(1):'—'}</td><td>${s.drillAngleDeg.toFixed(1)}°</td></tr>`; }
    if (i < s.aTabs.length) { const t = s.aTabs[i]; tabRows += `<tr><td style="color:#16a34a">Anode</td><td>${t.idx}</td><td>${t.turn}</td><td>${t.r.toFixed(2)}</td><td>${t.pitch.toFixed(2)}</td><td>${t.arcLen.toFixed(1)}</td><td>${t.spacing?t.spacing.toFixed(1):'—'}</td><td>${s.anodAngleDeg.toFixed(1)}°</td></tr>`; }
  }

  // Capacity info
  let capHtml = '';
  if (capResult) {
    const c = capResult;
    capHtml = `
    <h2>Mass & Capacity</h2>
    <table><tr><th></th><th>Cathode</th><th>Anode</th><th>Unit</th></tr>
    <tr><td>Thickness</td><td>${c.cathThickMm.toFixed(3)}</td><td>${c.anodThickMm.toFixed(3)}</td><td>mm</td></tr>
    <tr><td>Width</td><td>${c.cathWidthMm.toFixed(1)}</td><td>${c.anodWidthMm.toFixed(1)}</td><td>mm</td></tr>
    <tr><td>Length</td><td>${c.cathLenMm.toFixed(0)}</td><td>${c.anodLenMm.toFixed(0)}</td><td>mm</td></tr>
    <tr><td>Volume</td><td>${c.cathVolCm3.toFixed(1)}</td><td>${c.anodVolCm3.toFixed(1)}</td><td>cm³</td></tr>
    <tr><td>Total mass</td><td>${c.cathTotalMass.toFixed(1)}</td><td>${c.anodTotalMass.toFixed(1)}</td><td>g</td></tr>
    <tr><td>Mesh mass</td><td>${c.cathMeshMass.toFixed(1)}</td><td>${c.anodMeshMass.toFixed(1)}</td><td>g</td></tr>
    <tr><td>Paste mass</td><td>${c.cathPasteMass.toFixed(1)}</td><td>${c.anodPasteMass.toFixed(1)}</td><td>g</td></tr>
    <tr><td><b>Capacity</b></td><td><b style="color:#3b82f6">${c.cathCapAh.toFixed(1)}</b></td><td><b style="color:#16a34a">${c.anodCapAh.toFixed(1)}</b></td><td>Ah</td></tr>
    <tr><td>N:P ratio</td><td colspan="2" style="text-align:center"><b>${c.npRatio.toFixed(3)}</b></td><td></td></tr>
    <tr><td>Cell capacity (1e⁻)</td><td colspan="2" style="text-align:center"><b>${c.cellCapAh.toFixed(1)}</b></td><td>Ah</td></tr>
    <tr><td>Cell energy @1.2V</td><td colspan="2" style="text-align:center">${c.cellEnergy1e.toFixed(1)}</td><td>Wh</td></tr>
    <tr><td>Total dry mass</td><td colspan="2" style="text-align:center">${c.totalDryMass.toFixed(1)}</td><td>g</td></tr>
    </table>`;
  }

  // Open print window
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Jellyroll Design Report</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 20px; }
    h1 { font-size: 18px; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; }
    h2 { font-size: 14px; margin-top: 20px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    th, td { border: 1px solid #ddd; padding: 3px 6px; text-align: left; font-size: 10px; }
    th { background: #f3f4f6; font-weight: bold; }
    img { max-width: 100%; border: 1px solid #ddd; margin: 8px 0; }
    .views { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .view-box { page-break-inside: avoid; }
    .view-box h3 { font-size: 12px; margin: 4px 0; color: #555; }
    .params { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
    .params div { display: flex; justify-content: space-between; border-bottom: 1px dotted #ddd; padding: 2px 0; }
    .params span:first-child { color: #666; }
    @media print { body { margin: 10px; } .views { grid-template-columns: 1fr 1fr; } }
  </style></head><body>
  <h1>Jellyroll Battery Cell Designer — Design Report</h1>
  <p>Generated: ${new Date().toLocaleString()} | OD: ${(s.outerR*2).toFixed(1)}mm | Turns: ${s.turns.length} | Tabs: ${s.cTabs.length}C + ${s.aTabs.length}A</p>

  <h2>Cell Parameters</h2>
  <div class="params">
    <div><span>Mandrel diameter</span><span>${params.mandrel_d} mm</span></div>
    <div><span>Separator overhang</span><span>${params.sep_overhang} mm</span></div>
    <div><span>Computed OD</span><span>${(s.outerR*2).toFixed(1)} mm</span></div>
    <div><span>1st cathode tab</span><span>${s.solver ? s.solver.cathTabMm.toFixed(1) + 'mm (' + (s.solver.cathTabMm/25.4).toFixed(2) + '")' : 'N/A'}</span></div>
    <div><span>1st anode tab</span><span>${s.solver && s.solver.firstAnodTabAlongAnode >= 0 ? (s.solver.firstAnodTabAlongAnode/25.4).toFixed(2) + '"' : 'N/A'}</span></div>
    <div><span>Cathode drill angle</span><span>${s.drillAngleDeg.toFixed(1)}°</span></div>
    <div><span>Anode drill angle</span><span>${s.anodAngleDeg.toFixed(1)}° (+180°)</span></div>
    <div><span>Constraints</span><span style="color:${s.constraints && s.constraints.length === 0 ? '#16a34a' : '#ef4444'}">${s.constraints && s.constraints.length === 0 ? 'All OK' : s.constraints.length + ' violation(s)'}</span></div>
    <div><span>Cell height</span><span>${params.cell_h} mm</span></div>
    <div><span>Pitch range</span><span>${s.minPitch.toFixed(2)}–${s.maxPitch.toFixed(2)} mm</span></div>
  </div>

  <h2>Views</h2>
  <div class="views">
    <div class="view-box"><h3>Side View</h3><img src="${images.side}"></div>
    <div class="view-box"><h3>Top View</h3><img src="${images.top}"></div>
    <div class="view-box"><h3>Unroll View</h3><img src="${images.unroll}"></div>
    <div class="view-box"><h3>3D View</h3>${images['3d'] ? `<img src="${images['3d']}">` : '<p>N/A</p>'}</div>
  </div>

  <h2>Layer Stack</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Type</th><th>Thickness (mm)</th><th>Width (mm)</th><th>Length (mm)</th><th>Offset (mm)</th></tr>
    ${layerRows}
  </table>

  ${capHtml}

  <h2>Tab Positions</h2>
  <table>
    <tr><th>Electrode</th><th>Tab#</th><th>Turn</th><th>Radius (mm)</th><th>Pitch (mm)</th><th>Arc Length (mm)</th><th>Spacing (mm)</th><th>Angle</th></tr>
    ${tabRows}
  </table>

  <script>setTimeout(() => window.print(), 500);<\/script>
  </body></html>`);
  win.document.close();
});

// ========== CLOUD BUTTONS ==========
document.getElementById('btnApiSettings').addEventListener('click', () => {
  document.getElementById('settApiUrl').value = getApiUrl();
  document.getElementById('settApiKey').value = getApiKey();
  document.getElementById('modalSettings').classList.remove('hidden');
});

// ========== EXPERIMENTAL RESULT ==========
document.getElementById('btnAddExperimental').addEventListener('click', async () => {
  if (!isApiConfigured()) { document.getElementById('modalSettings').classList.remove('hidden'); return; }
  const modal = document.getElementById('modalExperimental');
  // Populate dropdowns with cloud mixes and layer stacks
  const cathSel = document.getElementById('expCathMix');
  const anodSel = document.getElementById('expAnodMix');
  const stackSel = document.getElementById('expLayerStack');
  const refSel = document.getElementById('expRefDesign');
  cathSel.innerHTML = '<option value="">-- Select --</option>';
  anodSel.innerHTML = '<option value="">-- Select --</option>';
  stackSel.innerHTML = '<option value="">-- Select --</option>';
  refSel.innerHTML = '<option value="">-- None --</option>';
  try {
    if (cloudMixes.length === 0) cloudMixes = await api.listMixes();
    cloudMixes.filter(m => m.type === 'cathode').forEach(m => {
      cathSel.innerHTML += `<option value="${m.id}">${m.name}</option>`;
    });
    cloudMixes.filter(m => m.type === 'anode').forEach(m => {
      anodSel.innerHTML += `<option value="${m.id}">${m.name}</option>`;
    });
    if (cloudLayerStacks.length === 0) cloudLayerStacks = await api.listLayerStacks();
    cloudLayerStacks.forEach(s => {
      stackSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
    // Populate reference design dropdown with non-experimental designs
    const designsData = await api.listDesigns(0, 200);
    (designsData.items || []).filter(d => !d.is_experimental).forEach(d => {
      refSel.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });
  } catch(e) { console.error('Failed to load cloud data for experimental form:', e); }
  // Reset all fields
  ['expMeasuredOD','expCathLen','expAnodLen',
   'expCathTabPos','expAnodTabPos'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('expCathTabPreview').textContent = '';
  document.getElementById('expAnodTabPreview').textContent = '';
  document.getElementById('expStatus').textContent = '';
  modal.classList.remove('hidden');
});

// ========== TAB POSITION PARSER ==========
// Parses mixed-format tab position input into an array of numbers (unit-preserved).
// Accepts:
//   "1: 6\", 2: 11 3/4\", 3: 18 5/16\""    (labeled with fractions)
//   "6, 11.75, 18.3125"                    (bare decimals)
//   "6\" 11 3/4\" 18 5/16\""               (whitespace-separated)
//   one per line, mixed separators, etc.
function parseTabPositions(raw) {
  if (!raw || !raw.trim()) return null;
  // Strip labels like "1:", "2)", "tab 3:" etc
  let s = raw.replace(/\b(?:tab\s*)?\d+\s*[:)\.\-]\s*/gi, ' ');
  // Replace inch marks and semicolons with commas for splitting
  s = s.replace(/["'`]/g, ' ').replace(/;/g, ',');
  // Split on commas or newlines
  const tokens = s.split(/[,\n]+/).map(t => t.trim()).filter(t => t.length);
  const values = [];
  for (const tok of tokens) {
    // A token might be "18 5/16" (whole + fraction), "11.75", "6", "5/8"
    const m = tok.match(/^(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      values.push(parseFloat(m[1]) + parseInt(m[2], 10) / parseInt(m[3], 10));
      continue;
    }
    const f = tok.match(/^(-?\d+)\s*\/\s*(\d+)$/);
    if (f) { values.push(parseInt(f[1], 10) / parseInt(f[2], 10)); continue; }
    const n = parseFloat(tok);
    if (!isNaN(n)) values.push(n);
  }
  return values.length > 0 ? values : null;
}

// Live preview for tab position textareas
function updateTabPreview(inputId, previewId) {
  const raw = document.getElementById(inputId).value;
  const unit = document.getElementById('expTabUnit').value;
  const vals = parseTabPositions(raw);
  const el = document.getElementById(previewId);
  if (!vals || vals.length === 0) { el.textContent = ''; return; }
  const mm = unit === 'in' ? vals.map(v => v * 25.4) : vals;
  const spacings = mm.slice(1).map((v, i) => v - mm[i]);
  const spStr = spacings.length ? ` • spacings (mm): ${spacings.map(s => s.toFixed(1)).join(', ')}` : '';
  el.innerHTML = `<span style="color:#16a34a">${vals.length} tabs</span> • first: <strong>${mm[0].toFixed(1)}mm</strong>${spStr}`;
}

['expCathTabPos', 'expAnodTabPos'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    updateTabPreview(id, id.replace('Pos', 'Preview'));
  });
});
document.getElementById('expTabUnit').addEventListener('change', () => {
  updateTabPreview('expCathTabPos', 'expCathTabPreview');
  updateTabPreview('expAnodTabPos', 'expAnodTabPreview');
});

document.getElementById('btnSaveExperimental').addEventListener('click', async () => {
  const name = document.getElementById('expName').value.trim();
  if (!name) { document.getElementById('expStatus').textContent = 'Name is required'; return; }

  const numOrNull = (id) => {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? null : v;
  };

  // Parse tab positions → derive mm array, first-tab, spacings, tab-data list, count
  const unit = document.getElementById('expTabUnit').value;
  const toMm = (v) => unit === 'in' ? v * 25.4 : v;
  const processTabInput = (inputId) => {
    const raw = document.getElementById(inputId).value;
    const vals = parseTabPositions(raw);
    if (!vals || vals.length === 0) return { mm: null, first: null, spacings: null, tabs: null, count: null };
    const mm = vals.map(toMm);
    const first = mm[0];
    const spacings = mm.length > 1 ? mm.slice(1).map((v, i) => +(v - mm[i]).toFixed(3)) : null;
    const tabs = mm.map((pos, i) => ({ tab_num: i + 1, arc_position_mm: +pos.toFixed(3) }));
    return { mm, first, spacings, tabs, count: mm.length };
  };
  const cathTabs = processTabInput('expCathTabPos');
  const anodTabs = processTabInput('expAnodTabPos');

  const notes = document.getElementById('expNotes').value.trim() || null;
  const refDesignId = document.getElementById('expRefDesign').value || null;

  // Determine cell_params_preset_id for the experimental record:
  //   1. If a Reference design is selected → inherit ITS cell_params_preset_id
  //      (the experiment is the measured outcome of that simulated design,
  //      so they should reference the exact same params).
  //   2. Otherwise → fall back to whatever is selected in the main preset panel.
  let expCellParamsPresetId = null;
  if (refDesignId) {
    try {
      const refDesign = await api.getDesign(refDesignId);
      expCellParamsPresetId = refDesign.cell_params_preset_id || null;
      if (!expCellParamsPresetId) {
        document.getElementById('expStatus').innerHTML =
          '<span style="color:#ef4444">Reference design has no cell params preset linked</span>';
        return;
      }
    } catch(e) {
      document.getElementById('expStatus').innerHTML =
        `<span style="color:#ef4444">Failed to read reference design: ${e.message}</span>`;
      return;
    }
  } else {
    expCellParamsPresetId = getSelectedCellParamsPresetId();
    if (!expCellParamsPresetId) {
      document.getElementById('expStatus').innerHTML =
        '<span style="color:#ef4444">Select a Reference design (preferred) or a cell params preset in the main panel</span>';
      return;
    }
  }

  const payload = {
    name,
    description: notes,
    is_experimental: true,
    cathode_mix_id: document.getElementById('expCathMix').value || null,
    anode_mix_id: document.getElementById('expAnodMix').value || null,
    layer_stack_id: document.getElementById('expLayerStack').value || null,
    reference_design_id: refDesignId,
    cell_params_preset_id: expCellParamsPresetId,
    layers: layers ? JSON.parse(JSON.stringify(layers)) : null, // snapshot of layer stack
    elec_props: { ...elecProps },      // snapshot of electrode properties
    experimental_data: {
      measured_od: numOrNull('expMeasuredOD'),
      cathode_length: numOrNull('expCathLen'),
      anode_length: numOrNull('expAnodLen'),
      cathode_tabs: cathTabs.tabs,
      anode_tabs: anodTabs.tabs,
      cathode_tab_spacings: cathTabs.spacings,
      anode_tab_spacings: anodTabs.spacings,
      first_cathode_tab_mm: cathTabs.first,
      first_anode_tab_mm: anodTabs.first,
      num_cathode_tabs: cathTabs.count,
      num_anode_tabs: anodTabs.count,
      notes,
    },
  };

  try {
    document.getElementById('expStatus').textContent = 'Saving...';
    // Experimental saves ALWAYS create a brand-new record — never update.
    // This prevents accidentally overwriting a non-experimental design with
    // experimental data, and ensures is_experimental=true is tied to the
    // button that was clicked.
    const saved = await api.createDesign(payload);
    // Track the new record as the loaded design so subsequent actions know
    // its flag — but leave currentDesignId pointing to it (matches user intent).
    currentDesignId = saved.id;
    currentDesignName = saved.name;
    currentDesignIsExperimental = true;
    document.getElementById('expStatus').innerHTML = `<span style="color:#16a34a">Saved: ${saved.name} (${saved.id})</span>`;
    showToast('Experimental result saved');
    setTimeout(() => document.getElementById('modalExperimental').classList.add('hidden'), 1500);
  } catch(e) {
    document.getElementById('expStatus').innerHTML = `<span style="color:#ef4444">Error: ${e.message}</span>`;
  }
});

// Read the currently selected cell params preset from the dropdown.
// Returns the cloud preset id, or null if nothing valid is selected.
// The user is expected to manage cell params presets explicitly via the
// preset panel (Save / Load buttons there). Save Design simply references
// whatever preset is currently selected.
function getSelectedCellParamsPresetId() {
  const sel = document.getElementById(PRESET_SELECTS.design);
  if (!sel) return null;
  const entry = presetStores.design[sel.value];
  if (entry && entry._cloud && entry._cloudId) return entry._cloudId;
  return null;
}

document.getElementById('btnCloudSave').addEventListener('click', async () => {
  if (!getApiUrl()) { document.getElementById('modalSettings').classList.remove('hidden'); return; }
  try {
    // Always prompt for a design name. Default to the currently loaded name
    // if any (so re-saving the same design is one Enter press), otherwise a
    // generic placeholder. If the user changes the name, treat as a new
    // record (Save As New).
    const defaultName = currentDesignName || 'Jellyroll Design';
    const designName = prompt('Design name:', defaultName);
    if (!designName) return; // cancelled
    if (designName !== currentDesignName) {
      currentDesignId = null;   // new name → new record
      currentDesignName = designName;
    }
    // If the currently loaded design is experimental, force a new record so
    // Save Design never silently overwrites/flips an experimental record.
    if (currentDesignIsExperimental) {
      currentDesignId = null;
      currentDesignIsExperimental = false;
    }

    // --- Auto-save cathode mix if not already in cloud ---
    let cathMixId = null;
    const cathSel = document.getElementById(PRESET_SELECTS.cathode);
    const cathEntry = presetStores.cathode[cathSel.value];
    if (cathEntry && cathEntry._cloudId) {
      cathMixId = cathEntry._cloudId;
    } else if (cathComponents.length > 0) {
      try {
        const payload = mixToApi(getCathodePreset(), 'cathode');
        payload.name = designName + ' — Cathode';
        const saved = await api.createMix(payload);
        cloudMixes.push(saved);
        cathMixId = saved.id;
        presetStores.cathode['☁ ' + saved.name] = { _cloudId: saved.id, _cloud: true };
        loadPresetList('cathode');
      } catch(e) { console.warn('Auto-save cathode mix failed:', e); }
    }

    // --- Auto-save anode mix if not already in cloud ---
    let anodMixId = null;
    const anodSel = document.getElementById(PRESET_SELECTS.anode);
    const anodEntry = presetStores.anode[anodSel.value];
    if (anodEntry && anodEntry._cloudId) {
      anodMixId = anodEntry._cloudId;
    } else if (anodComponents.length > 0) {
      try {
        const payload = mixToApi(getAnodePreset(), 'anode');
        payload.name = designName + ' — Anode';
        const saved = await api.createMix(payload);
        cloudMixes.push(saved);
        anodMixId = saved.id;
        presetStores.anode['☁ ' + saved.name] = { _cloudId: saved.id, _cloud: true };
        loadPresetList('anode');
      } catch(e) { console.warn('Auto-save anode mix failed:', e); }
    }

    // --- Auto-save layer stack if not already in cloud ---
    let layerStackId = null;
    const layerSel = document.getElementById(PRESET_SELECTS.layers);
    const layerEntry = presetStores.layers[layerSel.value];
    if (layerEntry && layerEntry._cloudId) {
      layerStackId = layerEntry._cloudId;
    } else if (layers.length > 0) {
      try {
        const payload = await layerStackToApi(layers);
        payload.name = designName + ' — Stack';
        const saved = await api.createLayerStack(payload);
        cloudLayerStacks.push(saved);
        layerStackId = saved.id;
        presetStores.layers['☁ ' + saved.name] = { _cloudId: saved.id, _cloud: true };
        loadPresetList('layers');
      } catch(e) { console.warn('Auto-save layer stack failed:', e); }
    }

    // --- Read selected cell params preset (must be picked in the preset panel) ---
    const cellParamsPresetId = getSelectedCellParamsPresetId();
    if (!cellParamsPresetId) {
      showToast('Select or save a cell params preset first', true);
      return;
    }

    // --- Save design with linked FKs ---
    // cell_params_preset_id: FK into cell_param_presets table (single source of truth)
    // layers:                complete layer stack snapshot (Layers tab)
    // elec_props:            electrode properties (Formulation tab)
    // FKs:                   cathode_mix_id / anode_mix_id / layer_stack_id for joined queries
    const designData = {
      name: designName,
      is_experimental: false,   // Save Design button = non-experimental. The
                                // Save Experimental button sets this to true.
      cell_params_preset_id: cellParamsPresetId,
      layers: JSON.parse(JSON.stringify(layers)),
      elec_props: { ...elecProps },
      cathode_mix_id: cathMixId,
      anode_mix_id: anodMixId,
      layer_stack_id: layerStackId,
    };
    let saved;
    if (currentDesignId) {
      saved = await api.updateDesign(currentDesignId, designData);
    } else {
      saved = await api.createDesign(designData);
      currentDesignId = saved.id;
      currentDesignName = saved.name;
    }
    currentDesignIsExperimental = false;

    // --- Also persist the current simulation + capacity results so the
    //     design record is always in sync with what the user sees on screen.
    //     This eliminates the "save design vs save sim" ambiguity: a single
    //     Save Design click captures the full current state.
    let simSaved = false, capSaved = false;
    try {
      if (simResult) {
        await api.saveSimResult(currentDesignId, {
          turns: simResult.turns,
          c_tabs: simResult.cTabs,
          a_tabs: simResult.aTabs,
          outer_r: simResult.outerR,
          min_pitch: simResult.minPitch,
          max_pitch: simResult.maxPitch,
          cathode_len: simResult.cathodeLen || null,
          anode_len: simResult.anodeLen || null,
        });
        simSaved = true;
      }
    } catch (e) { console.warn('Sim result save failed:', e); }
    try {
      if (capResult) {
        await api.saveCapResult(currentDesignId, {
          cath_cap_ah: capResult.cathCapAh,
          anod_cap_ah: capResult.anodCapAh,
          cell_cap_ah: capResult.cellCapAh,
          np_ratio: capResult.npRatio,
          cell_energy_1e: capResult.cellEnergy1e,
          total_dry_mass: capResult.totalDryMass,
          full_result: capResult,
        });
        capSaved = true;
      }
    } catch (e) { console.warn('Capacity result save failed:', e); }

    const extras = [];
    if (simSaved) extras.push('simulation');
    if (capSaved) extras.push('capacity');
    const extrasMsg = extras.length ? ` + ${extras.join(' & ')}` : '';
    showToast((currentDesignId ? 'Design updated' : 'Design saved') + ' in cloud' + extrasMsg);
  } catch (e) { showToast('Save failed: ' + e.message, true); }
});

document.getElementById('btnCloudOpen').addEventListener('click', async () => {
  if (!getApiUrl()) { document.getElementById('modalSettings').classList.remove('hidden'); return; }
  document.getElementById('modalCloudOpen').classList.remove('hidden');
  const list = document.getElementById('cloudDesignList');
  list.innerHTML = '<p style="color:var(--fg2);font-size:11px">Loading...</p>';
  try {
    const data = await api.listDesigns();
    if (data.items.length === 0) {
      list.innerHTML = '<p style="color:var(--fg2);font-size:11px">No saved designs found.</p>';
      return;
    }
    list.innerHTML = data.items.map(d => {
      const date = new Date(d.updated_at).toLocaleDateString();
      return `<div class="design-row" data-id="${d.id}">
        <span><strong>${d.name}</strong></span>
        <span style="color:var(--fg2)">${date}</span>
      </div>`;
    }).join('');
    list.querySelectorAll('.design-row').forEach(row => {
      row.addEventListener('click', async () => {
        try {
          const design = await api.getDesign(row.dataset.id);
          params = design.cell_params || design.params || {};
          layers = design.layers || [];
          layers.forEach(l => { delete l.startTurn; });
          // Migrate old params to new solver-based ranges
          if (params.first_cath_tab_min_in === undefined) {
            params.first_cath_tab_min_in = 4.5;
            params.first_cath_tab_max_in = 5.0;
            params.first_anod_tab_min_in = 6.0;
            params.first_anod_tab_max_in = 6.5;
            delete params.first_cath_tab; delete params.first_cath_arc;
            delete params.cath_angle; delete params.anod_angle; delete params.skip_turns;
            delete params.anode_end_tab_clearance;
          }
          delete params.separator_grab_distance; // now a machine constant
          delete params.cath_start_turn; delete params.anod_start_turn; delete params.sep_start_turn;
          if (design.elec_props) elecProps = design.elec_props;
          currentDesignId = design.id;
          currentDesignName = design.name;
          currentDesignIsExperimental = !!design.is_experimental;
          // Restore linked formulations if present
          if (design.cathode_mix) {
            applyCathodePreset(mixFromApi(design.cathode_mix));
            const cathSel = document.getElementById(PRESET_SELECTS.cathode);
            const cloudName = '☁ ' + design.cathode_mix.name;
            if (presetStores.cathode[cloudName]) cathSel.value = cloudName;
          }
          if (design.anode_mix) {
            applyAnodePreset(mixFromApi(design.anode_mix));
            const anodSel = document.getElementById(PRESET_SELECTS.anode);
            const cloudName = '☁ ' + design.anode_mix.name;
            if (presetStores.anode[cloudName]) anodSel.value = cloudName;
          }
          // Restore linked layer stack if present (and no inline layers)
          if (design.layer_stack && (!design.layers || design.layers.length === 0)) {
            const stackLayers = layerStackFromApi(design.layer_stack);
            if (stackLayers.length > 0) {
              layers.length = 0;
              stackLayers.forEach(l => layers.push(l));
            }
            const layerSel = document.getElementById(PRESET_SELECTS.layers);
            const cloudName = '☁ ' + design.layer_stack.name;
            if (presetStores.layers[cloudName]) layerSel.value = cloudName;
          }
          // Select the linked cell-params preset in the dropdown so the UI
          // reflects which preset the design points to.
          if (design.cell_params_preset) {
            const designSel = document.getElementById(PRESET_SELECTS.design);
            const cloudName = '☁ ' + design.cell_params_preset.name;
            if (presetStores.design[cloudName]) designSel.value = cloudName;
          }
          for (const [k, v] of Object.entries(params)) {
            const el = document.getElementById('p_' + k);
            if (el) el.value = v;
          }
          for (const [k, v] of Object.entries(elecProps)) {
            const el = document.getElementById('ep_' + k);
            if (el) el.value = v;
          }
          buildLayerUI();
          runSimulation();
          document.getElementById('modalCloudOpen').classList.add('hidden');
          showToast(`Loaded: ${design.name}`);
        } catch (e) { showToast('Load failed: ' + e.message, true); }
      });
    });
  } catch (e) {
    list.innerHTML = `<p style="color:#ef4444;font-size:11px">Error: ${e.message}</p>`;
  }
});

// ========== INIT ==========
initFormulation();
buildLayerUI();
runSimulation();
