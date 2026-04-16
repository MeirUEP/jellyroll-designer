function updateInfoBar() {
  if (!simResult) return;
  const s = simResult;
  const odLabel = `<span>OD: <strong>${s.actualOD.toFixed(1)}mm</strong> (target ${s.targetOD})</span>`;
  const pi = s.phaseInfo || {};
  const sepLen = layers.filter(l => l.type === 'separator').reduce((max, l) => Math.max(max, l.computedLen || 0), 0);
  let html =
    `<span>Turns: <strong>${s.turns.length}</strong> <span style="font-size:9px;color:var(--fg2)">(pre ${(pi.preTurns||0).toFixed(1)} + s+c ${(pi.cathWindTurns||0).toFixed(1)} + all ${(pi.mainTurns||0).toFixed(1)}${pi.anodeExtTurns > 0.001 ? ' + anod ' + pi.anodeExtTurns.toFixed(2) : ''}${pi.finalWrapTurns > 0.001 ? ' + wrap ' + pi.finalWrapTurns.toFixed(1) : ''})</span></span>` +
    odLabel +
    `<span>Cath L: <strong style="color:${s.cathodeLen > 2000 ? 'var(--red)' : '#3b82f6'}">${Math.round(s.cathodeLen)}mm</strong>${s.cathodeLen > 2000 ? ' <span title="Exceeds 2m coater limit">!</span>' : ''}</span>` +
    `<span>Anod L: <strong style="color:${s.anodeLen > 2000 ? 'var(--red)' : '#16a34a'}">${Math.round(s.anodeLen)}mm</strong>${s.anodeExtended ? ' <span style="color:var(--red)" title="Extended to clear tab">*</span>' : ''}${s.anodeLen > 2000 ? ' <span title="Exceeds 2m coater limit">!</span>' : ''}</span>` +
    `<span>Sep L: <strong style="color:var(--fg2)">${Math.round(sepLen)}mm</strong></span>` +
    `<span>Tabs: <strong style="color:#3b82f6">${s.cTabs.length}C</strong>+<strong style="color:#16a34a">${s.aTabs.length}A</strong></span>`;
  if (capResult) {
    html += `<span>Cell cap: <strong>${capResult.cellCapAh.toFixed(1)}Ah</strong></span>` +
            `<span>N:P: <strong>${capResult.npRatio.toFixed(3)}</strong></span>`;
  }
  document.getElementById('infoBar').innerHTML = html;
}

function updateSummary() {
  if (!simResult) return;
  const s = simResult;
  const odVal = `${s.actualOD.toFixed(1)}mm`;
  const pi2 = s.phaseInfo || {};
  const sepLen2 = layers.filter(l => l.type === 'separator').reduce((max, l) => Math.max(max, l.computedLen || 0), 0);
  const mainTurnsOver = (pi2.mainTurns || 0) > 9.01;
  const totalTurns = Math.round(s.turns.reduce((sum, t) => sum + (t.frac || 1), 0) * 10) / 10;
  const cards = [
    { lbl: 'Actual OD', val: odVal },
    { lbl: 'Total turns', val: totalTurns },
    { lbl: 'Pre turns', val: (pi2.preTurns || 0).toFixed(1) },
    { lbl: 'Sep+Cath turns', val: (pi2.cathWindTurns || 0).toFixed(1) },
    { lbl: 'Main turns', val: (pi2.mainTurns || 0).toFixed(1), cls: mainTurnsOver ? 'color:var(--red)' : '' },
    { lbl: 'Cathode length', val: `${Math.round(s.cathodeLen)}mm`, cls: 'color:#3b82f6' },
    { lbl: 'Anode length', val: `${Math.round(s.anodeLen)}mm${s.anodeExtended ? ' *' : ''}`, cls: 'color:#16a34a' },
    { lbl: 'Sep length', val: `${Math.round(sepLen2)}mm` },
    { lbl: 'Pitch range', val: `${s.minPitch.toFixed(2)}&ndash;${s.maxPitch.toFixed(2)}mm`, cls: s.minPitch < s.maxPitch * 0.85 ? 'color:var(--accent)' : '' },
    { lbl: 'Cathode tabs', val: s.cTabs.length, cls: 'color:#3b82f6' },
    { lbl: 'Anode tabs', val: s.aTabs.length, cls: 'color:#16a34a' },
  ];
  if (capResult) {
    cards.push(
      { lbl: 'Cathode cap.', val: `${capResult.cathCapAh.toFixed(1)}Ah`, cls: 'color:#3b82f6' },
      { lbl: 'Anode cap.', val: `${capResult.anodCapAh.toFixed(1)}Ah`, cls: 'color:#16a34a' },
      { lbl: 'N:P ratio', val: capResult.npRatio.toFixed(3) },
    );
  }
  document.getElementById('summaryCards').innerHTML = cards
    .map(c => `<div class="summary-card"><div class="val" style="${c.cls||''}">${c.val}</div><div class="lbl">${c.lbl}</div></div>`).join('');
}

// Which results tab is currently active: 'summary' or 'inventory'
let _activeResultsTab = 'summary';
function switchResultsTab(name) {
  _activeResultsTab = name;
  updateTable();
  // Trigger the inventory check when its tab becomes active
  if (name === 'inventory' && typeof runInventoryCheck === 'function') {
    runInventoryCheck();
  }
}

function updateTable() {
  if (!simResult) return;
  const s = simResult;

  // Tab nav — always visible at top of results area
  const tabBar = `
    <div class="results-tabs" style="display:flex;gap:2px;padding:4px 6px;background:var(--bg3);border-bottom:1px solid var(--border)">
      <button class="results-tab ${_activeResultsTab === 'summary' ? 'active' : ''}"
              style="padding:4px 10px;font-size:10px;border:none;border-bottom:2px solid ${_activeResultsTab === 'summary' ? 'var(--accent)' : 'transparent'};background:transparent;color:${_activeResultsTab === 'summary' ? 'var(--fg)' : 'var(--fg2)'};cursor:pointer"
              onclick="switchResultsTab('summary')">Summary &amp; Capacity</button>
      <button class="results-tab ${_activeResultsTab === 'inventory' ? 'active' : ''}"
              style="padding:4px 10px;font-size:10px;border:none;border-bottom:2px solid ${_activeResultsTab === 'inventory' ? 'var(--accent)' : 'transparent'};background:transparent;color:${_activeResultsTab === 'inventory' ? 'var(--fg)' : 'var(--fg2)'};cursor:pointer"
              onclick="switchResultsTab('inventory')">Inventory Check</button>
    </div>`;

  if (_activeResultsTab === 'inventory') {
    document.getElementById('resultsArea').innerHTML = tabBar +
      `<div id="invCheckPanel"><div style="padding:14px;color:var(--fg2);font-size:11px">Loading&hellip;</div></div>`;
    if (typeof runInventoryCheck === 'function') runInventoryCheck();
    return;
  }

  let rows = '';
  const maxLen = Math.max(s.cTabs.length, s.aTabs.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < s.cTabs.length) {
      const t = s.cTabs[i];
      rows += `<tr><td style="color:#3b82f6;font-weight:bold">Cathode</td><td>${t.idx}</td><td>${t.turn}</td><td>${t.r.toFixed(2)}</td><td>${t.pitch.toFixed(2)}</td><td>${t.arcLen.toFixed(1)}</td><td>${t.spacing ? t.spacing.toFixed(1) : '—'}</td><td>${s.drillAngleDeg.toFixed(1)}&deg;</td></tr>`;
    }
    if (i < s.aTabs.length) {
      const t = s.aTabs[i];
      rows += `<tr><td style="color:#16a34a;font-weight:bold">Anode</td><td>${t.idx}</td><td>${t.turn}</td><td>${t.r.toFixed(2)}</td><td>${t.pitch.toFixed(2)}</td><td>${t.arcLen.toFixed(1)}</td><td>${t.spacing ? t.spacing.toFixed(1) : '—'}</td><td>${s.anodAngleDeg.toFixed(1)}&deg;</td></tr>`;
    }
  }
  // Winding sequence summary (phase-based)
  const pi = s.phaseInfo || {};
  const seqParts = [
    `<span style="color:var(--fg2)">Overhang</span>`,
    `<span style="color:var(--fg)">Pre:</span> <span style="color:var(--accent)">${(pi.preTurns||0).toFixed(1)}T (sep)</span>`,
    `<span style="color:var(--fg)">Sep+Cath:</span> <span style="color:var(--accent)">${(pi.cathToAnodTurns||0).toFixed(1)}T</span>`,
    `<span style="color:var(--fg)">All layers:</span> <span style="color:var(--accent)">${(pi.mainTurns||0).toFixed(1)}T</span>`,
    ...(pi.anodeExtTurns > 0.001 ? [`<span style="color:var(--fg)">Anod ext:</span> <span style="color:#16a34a">${pi.anodeExtTurns.toFixed(2)}T</span>`] : []),
    `<span style="color:var(--fg)">Final wrap:</span> <span style="color:var(--accent)">1T (sep) &rarr; OD</span>`,
  ];
  const seqHtml = `<div style="padding:4px 10px;font-size:10px;color:var(--fg2);border-bottom:1px solid var(--border)"><strong>Winding sequence:</strong> ${seqParts.join(' &rarr; ')}</div>`;

  let tableHtml = seqHtml + `<table><thead><tr><th>Electrode</th><th>Tab#</th><th>Turn</th><th>Radius (mm)</th><th>Pitch (mm)</th><th>Arc Length (mm)</th><th>Spacing (mm)</th><th>Angle</th></tr></thead><tbody>${rows}</tbody></table>`;

  // Capacity & mass summary table
  if (capResult) {
    const c = capResult;
    tableHtml += `<div style="padding:6px 10px;border-top:1px solid var(--border)">
      <strong style="font-size:11px">Mass &amp; Capacity</strong>
      <div style="font-size:10px;color:var(--fg2);margin:2px 0">Geometry from layer stack &bull; Material properties from panels above</div>
      <table style="margin-top:4px"><thead><tr><th></th><th>Cathode</th><th>Anode</th><th>Unit</th><th style="color:var(--fg2)">Source</th></tr></thead><tbody>
      <tr style="color:var(--fg2)"><td>Thickness</td><td>${c.cathThickMm.toFixed(3)}</td><td>${c.anodThickMm.toFixed(3)}</td><td>mm</td><td>Layer stack</td></tr>
      <tr style="color:var(--fg2)"><td>Width</td><td>${c.cathWidthMm.toFixed(1)}</td><td>${c.anodWidthMm.toFixed(1)}</td><td>mm</td><td>Layer stack</td></tr>
      <tr style="color:var(--fg2)"><td>Length</td><td>${c.cathLenMm.toFixed(0)}</td><td>${c.anodLenMm.toFixed(0)}</td><td>mm</td><td>Layer stack</td></tr>
      <tr><td>Volume</td><td>${c.cathVolCm3.toFixed(1)}</td><td>${c.anodVolCm3.toFixed(1)}</td><td>cm&sup3;</td><td></td></tr>
      <tr><td>Total mass (w/ mesh)</td><td>${c.cathTotalMass.toFixed(1)}</td><td>${c.anodTotalMass.toFixed(1)}</td><td>g</td><td></td></tr>
      <tr><td>Mesh mass</td><td>${c.cathMeshMass.toFixed(1)}</td><td>${c.anodMeshMass.toFixed(1)}</td><td>g</td><td></td></tr>
      <tr><td>Paste mass</td><td>${c.cathPasteMass.toFixed(1)}</td><td>${c.anodPasteMass.toFixed(1)}</td><td>g</td><td></td></tr>
      <tr><td style="font-weight:bold">Capacity</td><td style="color:#3b82f6;font-weight:bold">${c.cathCapAh.toFixed(1)}</td><td style="color:#16a34a;font-weight:bold">${c.anodCapAh.toFixed(1)}</td><td>Ah</td><td></td></tr>
      <tr><td>N:P ratio</td><td colspan="2" style="text-align:center;font-weight:bold">${c.npRatio.toFixed(3)}</td><td></td><td></td></tr>
      <tr><td>Cell capacity (1e&minus;)</td><td colspan="2" style="text-align:center;font-weight:bold">${c.cellCapAh.toFixed(1)}</td><td>Ah</td><td></td></tr>
      <tr><td>Cell energy (1e&minus; @ 1.2V)</td><td colspan="2" style="text-align:center">${c.cellEnergy1e.toFixed(1)}</td><td>Wh</td><td></td></tr>
      <tr><td>Total dry mass</td><td colspan="2" style="text-align:center">${c.totalDryMass.toFixed(1)}</td><td>g</td><td></td></tr>
      </tbody></table>
    </div>`;

    // Utilization table
    tableHtml += `<div style="padding:6px 10px;border-top:1px solid var(--border)">
      <strong style="font-size:11px">Utilization Table</strong>
      <table style="margin-top:4px"><thead><tr><th>Cycled (Ah)</th><th>MnO2 Util. (%)</th><th>Anode Util. (%)</th><th>Energy @1.2V (Wh)</th><th>Anode Excess (%)</th><th>DoD (%)</th></tr></thead><tbody>`;
    c.utilTable.forEach(row => {
      tableHtml += `<tr><td>${row.cycledAh}</td><td>${row.cathUtil.toFixed(1)}</td><td>${row.anodUtil.toFixed(1)}</td><td>${row.energy.toFixed(0)}</td><td>${row.anodExcess.toFixed(0)}</td><td>${row.dod.toFixed(1)}</td></tr>`;
    });
    tableHtml += `</tbody></table></div>`;
  }

  document.getElementById('resultsArea').innerHTML = tabBar + tableHtml;
}

// ========== LAYER EDITOR ==========
function buildLayerUI() {
  const list = document.getElementById('layerList');
  list.innerHTML = '';
  const readonlyStyle = 'background:var(--bg3);color:var(--fg2);cursor:not-allowed';
  layers.forEach((l, i) => {
    // Resolve source: either inventory (non-electrode) or mix (electrode)
    const inv = l.inventory_item_id ? invById(l.inventory_item_id) : null;
    const mix = l.mix_id ? cloudMixes.find(m => m.id === l.mix_id) : null;
    const isElectrode = l.type === 'cathode' || l.type === 'anode';
    // Orphan = layer has no backing link. Could be legacy data from before
    // the inventory-driven refactor, or a broken reference after an
    // inventory/mix deletion.
    const orphan = !inv && !mix;
    // Thickness editable for electrodes (paste thickness is a design
    // input) and for orphans (so users can still tweak legacy data).
    // For inventory-backed passive layers it's readonly (from inv).
    const thickReadonly = !isElectrode && !orphan;
    // Width always readonly when we have a source — electrode width is
    // mesh-driven (set in Formulation tab), passive width is from inventory.
    const widthReadonly = !orphan;
    // Length only editable for fixed-length layers without a link; for
    // inventory tape/tab/other we could allow override, but keep it simple
    // and user-editable since length is design-specific.
    const lenEditable = !isElectrode && l.type !== 'separator';

    const sourceTag = orphan
      ? `<span title="Not linked to inventory or a mix — legacy data" style="font-size:8px;color:#f59e0b">⚠ orphan</span>`
      : inv
        ? `<span title="From inventory • ${inv.quantity} ${inv.unit} on hand" style="font-size:8px;color:var(--fg2)">&#128230; inv</span>`
        : `<span title="From saved mix" style="font-size:8px;color:var(--fg2)">mix</span>`;

    const card = document.createElement('div');
    card.className = 'layer-card';
    if (orphan) card.style.borderLeft = '3px solid #f59e0b';
    card.innerHTML = `
      <div class="layer-header">
        <input type="color" value="${l.color}" data-i="${i}" data-f="color" ${widthReadonly ? 'disabled title="Color inherited from source"' : ''}>
        <input type="text" value="${l.name}" data-i="${i}" data-f="name" ${!orphan ? `readonly style="${readonlyStyle}" title="Name inherited from ${inv ? 'inventory item' : 'mix'}"` : ''}>
        ${sourceTag}
        ${l.type==='cathode'?`<span class="badge">${simResult ? simResult.drillAngleDeg.toFixed(1) : '—'}&deg;</span>`:l.type==='anode'?`<span class="badge">${simResult ? simResult.anodAngleDeg.toFixed(1) : '—'}&deg;</span>`:''}
        <div class="layer-actions">
          <button class="btn-sm" data-move="${i}" data-dir="-1" ${i===0?'disabled':''}>&#9650;</button>
          <button class="btn-sm" data-move="${i}" data-dir="1" ${i===layers.length-1?'disabled':''}>&#9660;</button>
          <button class="btn-danger" data-del="${i}">&times;</button>
        </div>
      </div>
      ${orphan ? `<div style="font-size:9px;color:#f59e0b;padding:2px 4px;background:rgba(245,158,11,0.1);border-radius:3px;margin-bottom:3px">
        Legacy layer — no inventory or mix link. Delete and re-add from the dropdowns below to connect it.
      </div>` : ''}
      <div class="layer-props">
        <div class="param-item"><label>Thick${thickReadonly ? ' <span style="font-size:8px;color:var(--fg2)">(inv)</span>' : ''}</label>
          <input type="number" step="0.01" value="${l.t}" data-i="${i}" data-f="t" ${thickReadonly ? `readonly style="${readonlyStyle}" title="From inventory — edit the inventory item to change"` : ''}></div>
        <div class="param-item"><label>Width${widthReadonly ? ` <span style="font-size:8px;color:var(--fg2)">(${isElectrode ? 'mesh' : 'inv'})</span>` : ''}</label>
          <input type="number" step="0.1" value="${l.w}" data-i="${i}" data-f="w" ${widthReadonly ? `readonly style="${readonlyStyle}" title="${isElectrode ? 'Inherited from selected mesh (Formulation tab)' : 'From inventory item'}"` : ''}></div>
        ${isElectrode || l.type === 'separator'
          ? `<div class="param-item"><label>Length <span style="font-size:8px;color:var(--accent)">(computed)</span></label><input type="number" value="${l.computedLen ? Math.round(l.computedLen) : '—'}" data-i="${i}" data-f="len" readonly style="${readonlyStyle};color:${l.computedLen > 2000 ? 'var(--red)' : 'var(--fg2)'}" title="Computed from target OD"></div>`
          : `<div class="param-item"><label>Length</label><input type="number" step="1" value="${l.len || 0}" data-i="${i}" data-f="len" ${lenEditable ? '' : `readonly style="${readonlyStyle}"`}></div>`}
      </div>`;
    list.appendChild(card);
  });

  // Editable-field change handler (readonly fields don't fire change events)
  list.querySelectorAll('input:not([readonly]):not([disabled]),select').forEach(el => {
    el.addEventListener('change', e => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      if (f === 'name' || f === 'color') layers[i][f] = e.target.value;
      else layers[i][f] = +e.target.value;
      markDirty();
    });
  });
  list.querySelectorAll('[data-move]').forEach(el => {
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-move]');
      const i = +btn.dataset.move, d = +btn.dataset.dir;
      const j = i + d;
      if (j < 0 || j >= layers.length) return;
      [layers[i], layers[j]] = [layers[j], layers[i]];
      buildLayerUI(); markDirty();
    });
  });
  list.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-del]');
      layers.splice(+btn.dataset.del, 1);
      buildLayerUI(); markDirty();
    });
  });
}

function markDirty() {
  // Highlight Run button to indicate re-simulation needed (no auto-run — solver is expensive)
  document.getElementById('btnRun').classList.add('needs-run');
}

// btnAddLayer ("+ New") was removed — layers are now added exclusively
// via the Mix and Inventory dropdowns (see js/formulation.js
// addLayerFromMix / addLayerFromInventory). No blank layer path exists.

// Param inputs — auto-run on change
document.querySelectorAll('.param-grid input').forEach(el => {
  el.addEventListener('change', e => {
    const id = e.target.id;
    if (id.startsWith('p_')) {
      params[id.replace('p_','')] = +e.target.value;
    } else if (id.startsWith('ep_')) {
      elecProps[id.replace('ep_','')] = +e.target.value;
    }
    markDirty();
  });
});

