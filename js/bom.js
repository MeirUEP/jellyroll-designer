// ========== BOM TAB (Bill of Materials) ==========
// Renders into #bomPanel in the bottom results area.
// Computes per-cell cost from loaded design + inventory costs.

const BOM_COLORS = {
  paste: '#3b82f6',
  mesh: '#f59e0b',
  tabs: '#8b5cf6',
  separator: '#10b981',
  housing: '#6b7280',
  electrolyte: '#ef4444',
};

const BOM_ORDER = ['paste', 'mesh', 'tabs', 'separator', 'electrolyte', 'housing'];

function renderBOM() {
  const panel = document.getElementById('bomPanel');
  if (!panel) return;

  if (!simResult || !capResult) {
    panel.innerHTML = '<div style="padding:14px;color:var(--fg2);font-size:11px">Run simulation first to see BOM cost breakdown.</div>';
    return;
  }

  const regime = _bomRegime;
  const lines = computeBOMLines(regime);
  const totalCost = lines.reduce((s, l) => s + l.costPerCell, 0);

  const nominalV = params.nominal_voltage_v || 1.2;
  const energyWh = capResult.cellCapAh * nominalV;
  const massKg = capResult.totalDryMass / 1000;
  const dollarPerKwh = energyWh > 0 ? (totalCost / energyWh * 1000) : 0;
  const dollarPerKg = massKg > 0 ? (totalCost / massKg) : 0;

  // Build line items rows
  const lineRows = lines.map(l => {
    const costStr = l.costPerUnit != null ? '$' + l.costPerUnit.toFixed(4) : '—';
    const cellCostStr = l.costPerCell > 0 ? '$' + l.costPerCell.toFixed(4) : '—';
    const missing = l.costPerUnit == null;
    return `<tr style="${missing ? 'color:var(--fg2);opacity:0.6' : ''}">
      <td style="padding:3px 4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${BOM_COLORS[l.category] || '#888'};margin-right:4px;vertical-align:middle"></span>${l.category}</td>
      <td style="padding:3px 4px">${l.name}${missing ? ' <em>(no cost)</em>' : ''}</td>
      <td style="text-align:right;padding:3px 4px">${l.qty.toFixed(4)}</td>
      <td style="padding:3px 4px">${l.unit}</td>
      <td style="text-align:right;padding:3px 4px">${costStr}</td>
      <td style="text-align:right;padding:3px 4px;font-weight:bold">${cellCostStr}</td>
    </tr>`;
  }).join('');

  // Build pie chart SVG
  const pieHtml = buildBOMPieSVG(lines);

  panel.innerHTML = `
    <div style="padding:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:12px">Bill of Materials</strong>
        <select id="bomRegimeSelect" style="font-size:9px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--input-bg);color:var(--fg)" onchange="_bomRegime=this.value;localStorage.setItem('jr_bom_regime',this.value);renderBOM()">
          <option value="present" ${regime === 'present' ? 'selected' : ''}>Present Volume</option>
          <option value="gigascale" ${regime === 'gigascale' ? 'selected' : ''}>Gigascale</option>
        </select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;text-align:center">
        <div><div style="font-size:18px;font-weight:bold">${totalCost > 0 ? '$' + totalCost.toFixed(2) : '—'}</div><div style="font-size:9px;color:var(--fg2)">$/cell</div></div>
        <div><div style="font-size:18px;font-weight:bold">${dollarPerKwh > 0 ? '$' + dollarPerKwh.toFixed(0) : '—'}</div><div style="font-size:9px;color:var(--fg2)">$/kWh</div></div>
        <div><div style="font-size:18px;font-weight:bold">${energyWh > 0 ? energyWh.toFixed(1) : '—'}</div><div style="font-size:9px;color:var(--fg2)">Wh</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;text-align:center">
        <div><div style="font-size:14px;font-weight:bold">${massKg > 0 ? massKg.toFixed(2) : '—'}</div><div style="font-size:9px;color:var(--fg2)">mass (kg)</div></div>
        <div><div style="font-size:14px;font-weight:bold">${dollarPerKg > 0 ? '$' + dollarPerKg.toFixed(2) : '—'}</div><div style="font-size:9px;color:var(--fg2)">$/kg</div></div>
      </div>

      ${pieHtml}

      <table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:8px">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:3px 4px;color:var(--fg2)">Category</th>
            <th style="text-align:left;padding:3px 4px;color:var(--fg2)">Component</th>
            <th style="text-align:right;padding:3px 4px;color:var(--fg2)">Qty</th>
            <th style="text-align:left;padding:3px 4px;color:var(--fg2)">Unit</th>
            <th style="text-align:right;padding:3px 4px;color:var(--fg2)">$/Unit</th>
            <th style="text-align:right;padding:3px 4px;color:var(--fg2)">$/Cell</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);font-weight:bold">
            <td colspan="5" style="text-align:right;padding:4px">Total</td>
            <td style="text-align:right;padding:4px">$${totalCost.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
        <strong style="font-size:10px">Compare to Saved Design</strong>
        <select id="bomCompareDesign" style="width:100%;padding:3px;font-size:10px;margin-top:4px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--fg)" onchange="loadBOMComparison()">
          <option value="">— None —</option>
        </select>
        <div id="bomCompareResult" style="margin-top:6px;font-size:10px"></div>
      </div>
    </div>
  `;

  populateBOMCompareDropdown();
}

let _bomRegime = localStorage.getItem('jr_bom_regime') || 'present';

function computeBOMLines(regime) {
  const lines = [];
  const isGiga = regime === 'gigascale';

  function getCost(inv) {
    if (!inv) return null;
    return isGiga ? (inv.cost_per_unit_gigascale || inv.cost_per_unit) : inv.cost_per_unit;
  }

  function addLine(category, name, qty, unit, inv) {
    const costPerUnit = getCost(inv);
    lines.push({
      category, name, qty, unit, costPerUnit,
      costPerCell: costPerUnit != null ? qty * costPerUnit : 0,
    });
  }

  const cathode = layers.find(l => l.type === 'cathode');
  const anode = layers.find(l => l.type === 'anode');

  // Paste: cathode mix components
  if (cathode && capResult) {
    const pasteMassG = capResult.cathPasteMass || 0;
    (typeof cathComponents !== 'undefined' ? cathComponents : []).forEach(comp => {
      const qtyKg = pasteMassG * (comp.wt || 0) / 100 / 1000;
      const inv = comp.inventory_item_id ? invById(comp.inventory_item_id) : invByName(comp.name);
      addLine('paste', comp.name, qtyKg, 'kg', inv);
    });
  }

  // Paste: anode mix components
  if (anode && capResult) {
    const pasteMassG = capResult.anodPasteMass || 0;
    (typeof anodComponents !== 'undefined' ? anodComponents : []).forEach(comp => {
      const qtyKg = pasteMassG * (comp.wt || 0) / 100 / 1000;
      const inv = comp.inventory_item_id ? invById(comp.inventory_item_id) : invByName(comp.name);
      addLine('paste', comp.name, qtyKg, 'kg', inv);
    });
  }

  // Mesh: current collectors
  if (cathode && capResult) {
    const meshLenM = (capResult.cathLenMm || simResult.cathodeLen || 0) / 1000;
    const meshInv = invByName(elecProps.cath_cc_material) || null;
    if (meshLenM > 0) addLine('mesh', elecProps.cath_cc_material || 'Cathode mesh', meshLenM, 'm', meshInv);
  }
  if (anode && capResult) {
    const meshLenM = (capResult.anodLenMm || simResult.anodeLen || 0) / 1000;
    const meshInv = invByName(elecProps.anod_cc_material) || null;
    if (meshLenM > 0) addLine('mesh', elecProps.anod_cc_material || 'Anode mesh', meshLenM, 'm', meshInv);
  }

  // Separators
  layers.filter(l => l.type === 'separator').forEach(l => {
    const lenM = (l.computedLen || l.len || 0) / 1000;
    if (lenM <= 0) return;
    const inv = l.inventory_item_id ? invById(l.inventory_item_id) : invByName(l.name);
    addLine('separator', l.name, lenM, 'm', inv);
  });

  // Tabs
  if (simResult) {
    if (simResult.cTabs.length > 0) {
      const tabInv = invByName('Nickel Tab Strip') || invByName('Cathode tabs') || null;
      addLine('tabs', 'Cathode tabs', simResult.cTabs.length, 'pcs', tabInv);
    }
    if (simResult.aTabs.length > 0) {
      const tabInv = invByName('Copper Tab Strip') || invByName('Anode tabs') || null;
      addLine('tabs', 'Anode tabs', simResult.aTabs.length, 'pcs', tabInv);
    }
  }

  // Overhead (Phase 6)
  const overhead = params.bom_overhead || {};
  Object.entries(overhead).forEach(([key, cfg]) => {
    if (!cfg || !cfg.inv_id) return;
    const inv = invById(cfg.inv_id);
    const cat = ['electrolyte'].includes(key) ? 'electrolyte' : 'housing';
    addLine(cat, inv ? inv.name : key, cfg.qty || 0, cfg.unit || 'pcs', inv);
  });

  lines.sort((a, b) => {
    const ai = BOM_ORDER.indexOf(a.category);
    const bi = BOM_ORDER.indexOf(b.category);
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });

  return lines;
}

function buildBOMPieSVG(lines) {
  const catTotals = {};
  lines.forEach(l => { catTotals[l.category] = (catTotals[l.category] || 0) + l.costPerCell; });
  const total = Object.values(catTotals).reduce((s, v) => s + v, 0);
  if (total <= 0) return '';

  const entries = BOM_ORDER.filter(cat => catTotals[cat] > 0)
    .map(cat => ({ cat, val: catTotals[cat], pct: catTotals[cat] / total * 100 }));

  const size = 120, cx = size / 2, cy = size / 2, r = 50;
  let angle = -Math.PI / 2;
  let paths = '';

  entries.forEach(e => {
    const sweep = (e.val / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
    paths += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${BOM_COLORS[e.cat] || '#888'}"/>`;
    angle += sweep;
  });

  const legend = entries.map(e =>
    `<span style="display:inline-flex;align-items:center;gap:3px;margin:0 4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${BOM_COLORS[e.cat]}"></span>${e.cat} ${e.pct.toFixed(0)}%</span>`
  ).join('');

  return `<div style="text-align:center;margin-bottom:6px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
    <div style="font-size:9px;margin-top:4px">${legend}</div>
  </div>`;
}

async function populateBOMCompareDropdown() {
  const sel = document.getElementById('bomCompareDesign');
  if (!sel || !isApiConfigured()) return;
  try {
    const data = await api.listDesigns(0, 50);
    const current = sel.value;
    sel.innerHTML = '<option value="">— None —</option>';
    (data.items || []).forEach(d => {
      if (d.id === currentDesignId) return;
      sel.innerHTML += `<option value="${d.id}" ${d.id === current ? 'selected' : ''}>${d.name}</option>`;
    });
  } catch (e) { /* skip */ }
}

async function loadBOMComparison() {
  const designId = document.getElementById('bomCompareDesign').value;
  const resultEl = document.getElementById('bomCompareResult');
  if (!resultEl) return;
  if (!designId) { resultEl.innerHTML = ''; return; }

  try {
    resultEl.innerHTML = '<em style="color:var(--fg2)">Loading...</em>';
    const design = await api.getDesign(designId);
    if (!design || !design.cap_result) {
      resultEl.innerHTML = '<em style="color:var(--fg2)">No capacity data for this design</em>';
      return;
    }

    const nomV = (design.cell_params || design.params || {}).nominal_voltage_v || 1.2;
    const otherEnergy = (design.cap_result.cell_cap_ah || 0) * nomV;
    const myNomV = params.nominal_voltage_v || 1.2;
    const myEnergy = capResult.cellCapAh * myNomV;
    const myLines = computeBOMLines(_bomRegime);
    const myCost = myLines.reduce((s, l) => s + l.costPerCell, 0);
    const myKwh = myEnergy > 0 ? myCost / myEnergy * 1000 : 0;

    resultEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px">
        <div><strong>Current</strong><br>$${myCost.toFixed(2)}/cell &bull; ${myEnergy.toFixed(1)} Wh &bull; $${myKwh.toFixed(0)}/kWh</div>
        <div><strong>${design.name}</strong><br>${otherEnergy.toFixed(1)} Wh &bull; ${(design.cap_result.cell_cap_ah || 0).toFixed(1)} Ah &bull; N:P ${(design.cap_result.np_ratio || 0).toFixed(3)}</div>
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<em style="color:var(--red)">Error: ${e.message}</em>`;
  }
}
