// ========== INVENTORY FEASIBILITY CHECK ==========
// Given a simulated design + current inventory, compute "how many cells can
// I actually build from what's on the shelf?" The limiting component sets
// the overall answer; rows are color-coded by margin.
//
// Matching strategy:
//   - Separator / collector / tape / tab / other layers: match layer.name -> inventory_items.name
//   - Cathode / anode layers: decompose paste mass via cathComponents[] / anodComponents[] wt%,
//     then match each component's name -> inventory_items.name
//   - Current collector / mesh contribution is included inside the electrode paste calc
//     today — not broken out until the mix editor is inventory-driven.

// Cached feasibility inputs (items list for name lookup)
let invCheckCache = { items: [], loadedAt: 0 };

async function loadInventoryForCheck(force = false) {
  const now = Date.now();
  // Re-use for 30s to avoid hammering the API on repeated renders
  if (!force && invCheckCache.items.length && (now - invCheckCache.loadedAt < 30000)) {
    return invCheckCache.items;
  }
  if (!isApiConfigured()) return [];
  try {
    invCheckCache.items = (await api.listInventory()) || [];
    invCheckCache.loadedAt = now;
    return invCheckCache.items;
  } catch (e) {
    console.error('inventory-check: load failed', e);
    return [];
  }
}

// Convert an inventory item's on-hand quantity into a "normalized" value
// in the requested target unit ('mm' for lengths, 'g' for masses, 'pcs' for counts).
// Returns { value, ok } where ok=false means we couldn't convert (unit mismatch).
function normalizeInventoryQty(item, targetUnit) {
  const u = (item.unit || '').toLowerCase();
  const q = item.quantity || 0;
  if (targetUnit === 'mm') {
    if (u === 'mm') return { value: q, ok: true };
    if (u === 'cm') return { value: q * 10, ok: true };
    if (u === 'm' || u === 'lm') return { value: q * 1000, ok: true };
    if (u === 'ft' || u === 'lf') return { value: q * 304.8, ok: true };
    if (u === 'in') return { value: q * 25.4, ok: true };
    return { value: 0, ok: false };
  }
  if (targetUnit === 'g') {
    if (u === 'g') return { value: q, ok: true };
    if (u === 'kg') return { value: q * 1000, ok: true };
    if (u === 'lbs' || u === 'lb') return { value: q * 453.592, ok: true };
    // Volume -> mass requires density (g/cm^3)
    if ((u === 'l' || u === 'ml') && item.density) {
      const ml = u === 'l' ? q * 1000 : q;
      return { value: ml * item.density, ok: true };
    }
    return { value: 0, ok: false };
  }
  if (targetUnit === 'pcs') {
    if (u === 'pcs' || u === 'ea' || u === 'each') return { value: q, ok: true };
    return { value: 0, ok: false };
  }
  return { value: 0, ok: false };
}

// Find the first inventory item whose name matches (case-insensitive, trimmed).
function findInvItemByName(items, name) {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  return items.find(i => (i.name || '').trim().toLowerCase() === needle) || null;
}

// Build the list of feasibility rows for the current sim+cap+layers.
// Returns [{ role, component, perCell, perCellUnit, inventoryQty, inventoryUnit,
//            normalizedInv, cellsPossible, status, note }]
function buildFeasibilityRows(items) {
  const rows = [];
  if (!simResult) return rows;

  // --- Layer-by-layer (non-electrode) ---
  layers.forEach(l => {
    if (!l || l.type === 'cathode' || l.type === 'anode') return;
    // Per-cell length in mm (use computedLen if populated, otherwise len)
    const perCellMm = l.computedLen || l.len || 0;
    if (perCellMm <= 0) return;
    const inv = findInvItemByName(items, l.name);
    if (!inv) {
      rows.push({
        role: l.type,
        component: l.name,
        perCell: perCellMm, perCellUnit: 'mm',
        inventoryQty: null, inventoryUnit: null,
        normalizedInv: null, cellsPossible: null,
        status: 'missing',
        note: 'no inventory item with this name',
      });
      return;
    }
    const norm = normalizeInventoryQty(inv, 'mm');
    if (!norm.ok) {
      rows.push({
        role: l.type,
        component: l.name,
        perCell: perCellMm, perCellUnit: 'mm',
        inventoryQty: inv.quantity, inventoryUnit: inv.unit,
        normalizedInv: null, cellsPossible: null,
        status: 'unit_mismatch',
        note: `inventory unit "${inv.unit}" not convertible to mm`,
      });
      return;
    }
    const cells = Math.floor(norm.value / perCellMm);
    rows.push({
      role: l.type,
      component: l.name,
      perCell: perCellMm, perCellUnit: 'mm',
      inventoryQty: inv.quantity, inventoryUnit: inv.unit,
      normalizedInv: norm.value, cellsPossible: cells,
      status: 'ok', inv,
    });
  });

  // --- Chemicals (via cathode/anode mix decomposition) ---
  if (capResult) {
    const addMixRows = (comps, pasteMass, role) => {
      comps.forEach(c => {
        if (!c.name || !c.wt || c.wt <= 0) return;
        const perCellG = pasteMass * (c.wt / 100);
        if (perCellG <= 0) return;
        const inv = findInvItemByName(items, c.name);
        if (!inv) {
          rows.push({
            role,
            component: c.name,
            perCell: perCellG, perCellUnit: 'g',
            inventoryQty: null, inventoryUnit: null,
            normalizedInv: null, cellsPossible: null,
            status: 'missing',
            note: 'no inventory item with this name',
          });
          return;
        }
        const norm = normalizeInventoryQty(inv, 'g');
        if (!norm.ok) {
          rows.push({
            role,
            component: c.name,
            perCell: perCellG, perCellUnit: 'g',
            inventoryQty: inv.quantity, inventoryUnit: inv.unit,
            normalizedInv: null, cellsPossible: null,
            status: 'unit_mismatch',
            note: `inventory unit "${inv.unit}" not convertible to g (set density on item if volume-based)`,
          });
          return;
        }
        const cells = Math.floor(norm.value / perCellG);
        rows.push({
          role,
          component: c.name,
          perCell: perCellG, perCellUnit: 'g',
          inventoryQty: inv.quantity, inventoryUnit: inv.unit,
          normalizedInv: norm.value, cellsPossible: cells,
          status: 'ok', inv,
        });
      });
    };
    if (capResult.cathPasteMass > 0 && typeof cathComponents !== 'undefined') {
      addMixRows(cathComponents, capResult.cathPasteMass, 'cathode');
    }
    if (capResult.anodPasteMass > 0 && typeof anodComponents !== 'undefined') {
      addMixRows(anodComponents, capResult.anodPasteMass, 'anode');
    }
  }

  return rows;
}

// Compute the overall limit from the rows (the minimum cellsPossible across
// all rows with status='ok'). Returns null if no valid rows.
function overallCellLimit(rows) {
  const valid = rows.filter(r => r.status === 'ok' && Number.isFinite(r.cellsPossible));
  if (!valid.length) return null;
  return Math.min(...valid.map(r => r.cellsPossible));
}

// Render the feasibility panel into the given element. `targetCells` is the
// user's desired batch size; rows that can't meet it are red, ones within
// 2x are yellow, else green.
function renderFeasibilityPanel(container, rows, targetCells) {
  const limit = overallCellLimit(rows);
  const missingCount = rows.filter(r => r.status !== 'ok').length;
  const okRows = rows.filter(r => r.status === 'ok');

  const header = `
    <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div>
        <strong style="font-size:12px">Inventory Feasibility</strong>
        <div style="font-size:9px;color:var(--fg2)">Cells buildable from current inventory</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <label style="font-size:10px;color:var(--fg2)">Target cells</label>
        <input type="number" id="invCheckTarget" min="1" value="${targetCells}" style="width:70px" onchange="refreshFeasibilityPanel()">
      </div>
      <div style="margin-left:auto;font-size:12px">
        ${limit !== null
          ? `Max cells: <strong style="color:${limit >= targetCells ? 'var(--green,#10b981)' : 'var(--red,#ef4444)'}">${limit}</strong>`
          : '<span style="color:var(--fg2)">(no matched components)</span>'}
        ${missingCount ? `<span style="color:var(--accent);margin-left:10px">${missingCount} unmatched</span>` : ''}
      </div>
    </div>`;

  if (!rows.length) {
    container.innerHTML = header + `<div style="padding:14px;color:var(--fg2);font-size:11px">
      Run a simulation to populate the feasibility check. The table matches
      every layer &amp; chemical in the current design against inventory items
      by name.</div>`;
    return;
  }

  const rowHtml = rows.map(r => {
    let statusColor = 'var(--fg2)';
    let statusText = '—';
    if (r.status === 'ok') {
      if (r.cellsPossible >= targetCells) {
        statusColor = '#10b981';
        statusText = 'OK';
      } else if (r.cellsPossible >= targetCells / 2) {
        statusColor = '#f59e0b';
        statusText = 'LOW';
      } else {
        statusColor = '#ef4444';
        statusText = 'SHORT';
      }
    } else if (r.status === 'missing') {
      statusColor = '#ef4444';
      statusText = 'MISSING';
    } else if (r.status === 'unit_mismatch') {
      statusColor = '#f59e0b';
      statusText = 'UNIT?';
    }

    const perCellStr = `${r.perCell.toFixed(r.perCellUnit === 'g' ? 3 : 1)} ${r.perCellUnit}`;
    const invStr = (r.inventoryQty !== null && r.inventoryUnit)
      ? `${r.inventoryQty.toFixed(2)} ${r.inventoryUnit}`
      : '—';
    const normStr = (r.normalizedInv !== null)
      ? `${r.normalizedInv.toFixed(r.perCellUnit === 'g' ? 1 : 0)} ${r.perCellUnit}`
      : '—';
    const cellsStr = (r.cellsPossible !== null) ? r.cellsPossible : '—';
    const neededQty = r.perCell * targetCells;
    const needed = (r.status === 'ok')
      ? `${neededQty.toFixed(r.perCellUnit === 'g' ? 1 : 0)} ${r.perCellUnit}`
      : '—';
    // Cost estimate: cost_per_unit is in $/inventory-unit, per-cell is in normalized
    // (mm or g). Convert per-cell → inventory-unit using the inverse of normalizeInventoryQty.
    let costStr = '—';
    if (r.status === 'ok' && r.inv && r.inv.cost_per_unit && r.normalizedInv > 0 && r.inventoryQty > 0) {
      const invUnitPerNorm = r.inventoryQty / r.normalizedInv;   // e.g. kg per g, or ft per mm
      const costPerCell = r.perCell * invUnitPerNorm * r.inv.cost_per_unit;
      const batchCost = costPerCell * targetCells;
      costStr = `$${costPerCell.toFixed(3)} / $${batchCost.toFixed(2)}`;
    }

    const roleColor = r.role === 'cathode' ? '#3b82f6'
                    : r.role === 'anode' ? '#16a34a'
                    : r.role === 'separator' ? '#a855f7'
                    : r.role === 'collector' ? '#f59e0b'
                    : r.role === 'tab' ? '#c0c0c0'
                    : 'var(--fg2)';

    return `<tr style="border-left:3px solid ${statusColor}">
      <td style="color:${roleColor};font-weight:bold">${r.role}</td>
      <td>${r.component}</td>
      <td>${perCellStr}</td>
      <td>${needed}</td>
      <td>${invStr}</td>
      <td>${normStr}</td>
      <td style="font-weight:bold">${cellsStr}</td>
      <td>${costStr}</td>
      <td style="color:${statusColor};font-weight:bold">${statusText}${r.note ? ` <span style="font-weight:normal;color:var(--fg2);font-size:9px">(${r.note})</span>` : ''}</td>
    </tr>`;
  }).join('');

  // Batch cost total (cost across all OK rows)
  let batchTotal = 0;
  rows.forEach(r => {
    if (r.status === 'ok' && r.inv && r.inv.cost_per_unit && r.normalizedInv > 0 && r.inventoryQty > 0) {
      const invUnitPerNorm = r.inventoryQty / r.normalizedInv;
      batchTotal += r.perCell * invUnitPerNorm * r.inv.cost_per_unit * targetCells;
    }
  });
  const batchTotalStr = batchTotal > 0 ? `$${batchTotal.toFixed(2)}` : '—';

  const table = `
    <table>
      <thead><tr>
        <th>Role</th>
        <th>Component</th>
        <th>Per cell</th>
        <th>Needed (${targetCells} cells)</th>
        <th>Inventory</th>
        <th>Inv (normalized)</th>
        <th>Cells possible</th>
        <th>Cost (cell / ${targetCells} cells)</th>
        <th>Status</th>
      </tr></thead>
      <tbody>${rowHtml}</tbody>
      <tfoot>
        <tr style="background:var(--bg3);font-weight:bold">
          <td colspan="7" style="text-align:right">Estimated batch material cost (${targetCells} cells):</td>
          <td colspan="2">${batchTotalStr}</td>
        </tr>
      </tfoot>
    </table>`;

  const footer = (missingCount > 0) ? `
    <div style="padding:6px 10px;background:var(--bg3);font-size:10px;color:var(--fg2);border-top:1px solid var(--border)">
      <strong>Note:</strong> Unmatched components aren't counted toward the max-cells estimate.
      Add a matching inventory item (same name) to include them in the check.
    </div>` : '';

  container.innerHTML = header + table + footer;
}

// Default target cells (persisted in localStorage so the user's preference sticks)
function getTargetCells() {
  const v = parseInt(localStorage.getItem('jr_inv_target_cells') || '30', 10);
  return (Number.isFinite(v) && v > 0) ? v : 30;
}
function setTargetCells(v) {
  if (Number.isFinite(v) && v > 0) localStorage.setItem('jr_inv_target_cells', String(v));
}

async function runInventoryCheck() {
  const container = document.getElementById('invCheckPanel');
  if (!container) return;
  if (!simResult) {
    container.innerHTML = `<div style="padding:14px;color:var(--fg2);font-size:11px">Run a simulation first.</div>`;
    return;
  }
  if (!isApiConfigured()) {
    container.innerHTML = `<div style="padding:14px;color:var(--fg2);font-size:11px">API not configured — set API URL &amp; Key in settings to enable inventory feasibility check.</div>`;
    return;
  }
  container.innerHTML = `<div style="padding:14px;color:var(--fg2);font-size:11px">Loading inventory&hellip;</div>`;
  const items = await loadInventoryForCheck();
  const rows = buildFeasibilityRows(items);
  renderFeasibilityPanel(container, rows, getTargetCells());
}

// Re-render with updated target-cells input (called from the input's onchange).
function refreshFeasibilityPanel() {
  const input = document.getElementById('invCheckTarget');
  if (input) {
    const v = parseInt(input.value, 10);
    if (Number.isFinite(v) && v > 0) setTargetCells(v);
  }
  const container = document.getElementById('invCheckPanel');
  if (!container) return;
  const rows = buildFeasibilityRows(invCheckCache.items);
  renderFeasibilityPanel(container, rows, getTargetCells());
}
