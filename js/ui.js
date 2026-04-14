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

function updateTable() {
  if (!simResult) return;
  const s = simResult;
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

  document.getElementById('resultsArea').innerHTML = tableHtml;
}

// ========== LAYER EDITOR ==========
function buildLayerUI() {
  const list = document.getElementById('layerList');
  list.innerHTML = '';
  layers.forEach((l, i) => {
    const card = document.createElement('div');
    card.className = 'layer-card';
    card.innerHTML = `
      <div class="layer-header">
        <input type="color" value="${l.color}" data-i="${i}" data-f="color">
        <input type="text" value="${l.name}" data-i="${i}" data-f="name">
        <select data-i="${i}" data-f="type">${LAYER_TYPES.map(t=>`<option value="${t}"${t===l.type?' selected':''}>${t}</option>`).join('')}</select>
        ${l.type==='cathode'?`<span class="badge">${simResult ? simResult.drillAngleDeg.toFixed(1) : '—'}&deg;</span>`:l.type==='anode'?`<span class="badge">${simResult ? simResult.anodAngleDeg.toFixed(1) : '—'}&deg;</span>`:''}
        <div class="layer-actions">
          <button class="btn-sm" data-save-layer="${i}" title="Save to library" style="padding:1px 3px;font-size:8px">&#128190;</button>
          <button class="btn-sm" data-move="${i}" data-dir="-1" ${i===0?'disabled':''}>&#9650;</button>
          <button class="btn-sm" data-move="${i}" data-dir="1" ${i===layers.length-1?'disabled':''}>&#9660;</button>
          <button class="btn-danger" data-del="${i}">&times;</button>
        </div>
      </div>
      <div class="layer-props">
        <div class="param-item"><label>Thick</label><input type="number" step="0.01" value="${l.t}" data-i="${i}" data-f="t"></div>
        <div class="param-item"><label>Width</label><input type="number" step="0.1" value="${l.w}" data-i="${i}" data-f="w"></div>
        ${l.type === 'anode' || l.type === 'cathode' || l.type === 'separator'
          ? `<div class="param-item"><label>Length <span style="font-size:8px;color:var(--accent)">(computed)</span></label><input type="number" value="${l.computedLen ? Math.round(l.computedLen) : '—'}" data-i="${i}" data-f="len" readonly style="background:var(--bg3);color:${l.computedLen > 2000 ? 'var(--red)' : 'var(--fg2)'};cursor:not-allowed" title="Computed from target OD"></div>`
          : `<div class="param-item"><label>Length</label><input type="number" step="1" value="${l.len}" data-i="${i}" data-f="len"></div>`}
      </div>`;
    list.appendChild(card);
  });

  list.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('change', e => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      if (f === 'name' || f === 'color' || f === 'type') layers[i][f] = e.target.value;
      else layers[i][f] = +e.target.value;
      markDirty();
      if (f === 'type') buildLayerUI();
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
  list.querySelectorAll('[data-save-layer]').forEach(el => {
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-save-layer]');
      const l = layers[+btn.dataset.saveLayer];
      saveLayerToLib(l);
    });
  });
}

function markDirty() {
  // Highlight Run button to indicate re-simulation needed (no auto-run — solver is expensive)
  document.getElementById('btnRun').classList.add('needs-run');
}

document.getElementById('btnAddLayer').addEventListener('click', () => {
  layers.push({name:'New Layer',type:'separator',t:0.1,w:220,color:'#888888'});
  buildLayerUI(); markDirty();
});

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

