// ========== BOM TAB (Bill of Materials) ==========
// Computes per-cell cost from loaded design + inventory costs.
// All calculations are client-side using cloudInventory cache.

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
  if (!simResult || !capResult) {
    document.getElementById('bomCostPerCell').textContent = '—';
    document.getElementById('bomDollarPerKwh').textContent = '—';
    document.getElementById('bomEnergyWh').textContent = '—';
    document.getElementById('bomMassKg').textContent = '—';
    document.getElementById('bomDollarPerKg').textContent = '—';
    document.getElementById('bomLineBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--fg2);padding:12px">Run simulation first</td></tr>';
    document.getElementById('bomLineFoot').innerHTML = '';
    document.getElementById('bomPieChart').innerHTML = '';
    document.getElementById('bomPieLegend').innerHTML = '';
    return;
  }

  const regime = document.getElementById('bomRegime').value;
  const lines = computeBOMLines(regime);
  const totalCost = lines.reduce((s, l) => s + l.costPerCell, 0);

  const nominalV = params.nominal_voltage_v || 1.2;
  const energyWh = capResult.cellCapAh * nominalV;
  const massKg = capResult.totalDryMass / 1000;
  const dollarPerKwh = energyWh > 0 ? (totalCost / energyWh * 1000) : 0;
  const dollarPerKg = massKg > 0 ? (totalCost / massKg) : 0;

  // Summary cards
  document.getElementById('bomCostPerCell').textContent = totalCost > 0 ? '$' + totalCost.toFixed(2) : '—';
  document.getElementById('bomDollarPerKwh').textContent = dollarPerKwh > 0 ? '$' + dollarPerKwh.toFixed(0) : '—';
  document.getElementById('bomEnergyWh').textContent = energyWh > 0 ? energyWh.toFixed(1) : '—';
  document.getElementById('bomMassKg').textContent = massKg > 0 ? massKg.toFixed(2) : '—';
  document.getElementById('bomDollarPerKg').textContent = dollarPerKg > 0 ? '$' + dollarPerKg.toFixed(2) : '—';

  // Line items table
  const tbody = document.getElementById('bomLineBody');
  tbody.innerHTML = lines.map(l => {
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

  document.getElementById('bomLineFoot').innerHTML = `
    <tr style="border-top:2px solid var(--border);font-weight:bold">
      <td colspan="5" style="text-align:right;padding:4px">Total</td>
      <td style="text-align:right;padding:4px">$${totalCost.toFixed(2)}</td>
    </tr>`;

  // Pie chart
  renderBOMPie(lines);

  // Populate compare dropdown
  populateBOMCompareDropdown();
}

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
      category,
      name,
      qty,
      unit,
      costPerUnit,
      costPerCell: costPerUnit != null ? qty * costPerUnit : 0,
      inventoryItem: inv,
    });
  }

  // --- PASTE: cathode + anode mix components ---
  const cathode = layers.find(l => l.type === 'cathode');
  const anode = layers.find(l => l.type === 'anode');

  if (cathode && capResult) {
    const pasteMassG = capResult.cathPasteMass || 0;
    (typeof cathComponents !== 'undefined' ? cathComponents : []).forEach(comp => {
      const wtFrac = (comp.wt || 0) / 100;
      const qtyKg = pasteMassG * wtFrac / 1000;
      const inv = comp.inventory_item_id ? invById(comp.inventory_item_id) : invByName(comp.name);
      addLine('paste', comp.name, qtyKg, 'kg', inv);
    });
  }

  if (anode && capResult) {
    const pasteMassG = capResult.anodPasteMass || 0;
    (typeof anodComponents !== 'undefined' ? anodComponents : []).forEach(comp => {
      const wtFrac = (comp.wt || 0) / 100;
      const qtyKg = pasteMassG * wtFrac / 1000;
      const inv = comp.inventory_item_id ? invById(comp.inventory_item_id) : invByName(comp.name);
      addLine('paste', comp.name, qtyKg, 'kg', inv);
    });
  }

  // --- MESH: current collectors ---
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

  // --- SEPARATOR: each separator layer ---
  layers.filter(l => l.type === 'separator').forEach(l => {
    const lenM = (l.computedLen || l.len || 0) / 1000;
    if (lenM <= 0) return;
    const inv = l.inventory_item_id ? invById(l.inventory_item_id) : invByName(l.name);
    addLine('separator', l.name, lenM, 'm', inv);
  });

  // --- TABS: from simulation result ---
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

  // --- OVERHEAD: from cell_params.bom_overhead (Phase 6) ---
  const overhead = params.bom_overhead || {};
  Object.entries(overhead).forEach(([key, cfg]) => {
    if (!cfg || !cfg.inv_id) return;
    const inv = invById(cfg.inv_id);
    const cat = ['electrolyte'].includes(key) ? 'electrolyte' : 'housing';
    addLine(cat, inv ? inv.name : key, cfg.qty || 0, cfg.unit || 'pcs', inv);
  });

  // Sort by category order then name
  lines.sort((a, b) => {
    const ai = BOM_ORDER.indexOf(a.category);
    const bi = BOM_ORDER.indexOf(b.category);
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });

  return lines;
}

// ========== PIE CHART (SVG) ==========
function renderBOMPie(lines) {
  const chartEl = document.getElementById('bomPieChart');
  const legendEl = document.getElementById('bomPieLegend');

  // Aggregate by category
  const catTotals = {};
  lines.forEach(l => {
    catTotals[l.category] = (catTotals[l.category] || 0) + l.costPerCell;
  });

  const total = Object.values(catTotals).reduce((s, v) => s + v, 0);
  if (total <= 0) {
    chartEl.innerHTML = '<p style="color:var(--fg2);font-size:10px">No cost data</p>';
    legendEl.innerHTML = '';
    return;
  }

  const entries = BOM_ORDER
    .filter(cat => catTotals[cat] > 0)
    .map(cat => ({ cat, val: catTotals[cat], pct: catTotals[cat] / total * 100 }));

  // SVG pie
  const size = 140, cx = size / 2, cy = size / 2, r = 55;
  let angle = -Math.PI / 2;
  let paths = '';

  entries.forEach(e => {
    const sweep = (e.val / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep);
    const y2 = cy + r * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${BOM_COLORS[e.cat] || '#888'}"/>`;
    angle += sweep;
  });

  chartEl.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>`;

  legendEl.innerHTML = entries.map(e =>
    `<span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${BOM_COLORS[e.cat]}"></span>${e.cat} ${e.pct.toFixed(0)}%</span>`
  ).join('');
}

// ========== DESIGN COMPARISON ==========
async function populateBOMCompareDropdown() {
  const sel = document.getElementById('bomCompareDesign');
  if (!sel || !isApiConfigured()) return;
  const current = sel.value;
  try {
    const data = await api.listDesigns(0, 50);
    sel.innerHTML = '<option value="">— None —</option>';
    (data.items || []).forEach(d => {
      if (d.id === currentDesignId) return;
      sel.innerHTML += `<option value="${d.id}" ${d.id === current ? 'selected' : ''}>${d.name}</option>`;
    });
  } catch (e) { /* silently skip if API unavailable */ }
}

async function loadBOMComparison() {
  const designId = document.getElementById('bomCompareDesign').value;
  const resultEl = document.getElementById('bomCompareResult');
  if (!designId) { resultEl.innerHTML = ''; return; }

  try {
    resultEl.innerHTML = '<em style="color:var(--fg2)">Loading...</em>';
    const design = await api.getDesign(designId);
    if (!design || !design.sim_result || !design.cap_result) {
      resultEl.innerHTML = '<em style="color:var(--fg2)">No simulation data for this design</em>';
      return;
    }

    const regime = document.getElementById('bomRegime').value;
    const myLines = computeBOMLines(regime);
    const myCost = myLines.reduce((s, l) => s + l.costPerCell, 0);

    // Estimate other design's cost from its sim/cap results (simplified)
    const otherCap = design.cap_result.full_result || {};
    const nomV = (design.cell_params || design.params || {}).nominal_voltage_v || 1.2;
    const otherEnergy = (design.cap_result.cell_cap_ah || 0) * nomV;

    const myEnergy = capResult.cellCapAh * (params.nominal_voltage_v || 1.2);
    const myKwh = myEnergy > 0 ? myCost / myEnergy * 1000 : 0;

    resultEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px">
        <div>
          <strong>Current design</strong><br>
          Cost: $${myCost.toFixed(2)}/cell<br>
          Energy: ${myEnergy.toFixed(1)} Wh<br>
          $/kWh: $${myKwh.toFixed(0)}
        </div>
        <div>
          <strong>${design.name}</strong><br>
          Energy: ${otherEnergy.toFixed(1)} Wh<br>
          Cap: ${(design.cap_result.cell_cap_ah || 0).toFixed(1)} Ah<br>
          N:P: ${(design.cap_result.np_ratio || 0).toFixed(3)}
        </div>
      </div>
    `;
  } catch (e) {
    resultEl.innerHTML = `<em style="color:var(--red)">Error: ${e.message}</em>`;
  }
}

// Persist regime choice
const savedRegime = localStorage.getItem('jr_bom_regime');
if (savedRegime) {
  const sel = document.getElementById('bomRegime');
  if (sel) sel.value = savedRegime;
}
document.getElementById('bomRegime')?.addEventListener('change', () => {
  localStorage.setItem('jr_bom_regime', document.getElementById('bomRegime').value);
});
