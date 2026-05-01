// ========== INVENTORY DASHBOARD ==========
// Standalone table/sort/filter logic for inventory.html
// Reuses modals from inventory-ui.js (Add, Update, Receive, Count)

let dashItems = [];
let dashLowStock = [];
let sortCol = 'name';
let sortAsc = true;
let expandedItemId = null;  // which item has lots sub-row open

// Reorder tab state
let reorderRows = [];           // merged items + consumption stats
let reorderSortCol = 'status';  // sorted by urgency by default
let reorderSortAsc = true;
let reorderWindowDays = 30;

// Activity tab state
let activityRows = [];
let activityOffset = 0;
const activityLimit = 50;

// ========== INITIALIZATION ==========
async function loadDashboard() {
  if (!isApiConfigured()) {
    document.getElementById('itemsBody').innerHTML = '<tr><td colspan="9" class="no-items">API not configured. Click the gear icon to set API URL and Key.</td></tr>';
    return;
  }
  try {
    const [items, lowStock, summary] = await Promise.all([
      api.listInventory(),
      api.lowStock(),
      api.inventorySummary(),
    ]);
    dashItems = items || [];
    dashLowStock = lowStock || [];

    // Update stat cards
    document.getElementById('statTotalItems').textContent = dashItems.length;
    document.getElementById('statLowStock').textContent = dashLowStock.length;
    const totalLots = dashItems.reduce((sum, i) => sum + (i.lot_count || 0), 0);
    document.getElementById('statTotalLots').textContent = totalLots || '—';
    document.getElementById('statCategories').textContent = (summary || []).length;

    // Populate filter dropdowns from actual data
    populateFilters();
    renderTable();
    renderLowStock();

    // Mirror into invCache for modal reuse
    if (typeof invCache !== 'undefined') invCache.items = dashItems;
  } catch (e) {
    document.getElementById('itemsBody').innerHTML = `<tr><td colspan="9" class="no-items" style="color:var(--red)">Failed to load: ${e.message}</td></tr>`;
  }
}

function populateFilters() {
  const types = [...new Set(dashItems.map(i => i.type).filter(Boolean))].sort();
  const processes = [...new Set(dashItems.map(i => i.process_step).filter(Boolean))].sort();
  const boms = [...new Set(dashItems.map(i => i.bom_category).filter(Boolean))].sort();

  const typeSel = document.getElementById('filterType');
  typeSel.innerHTML = '<option value="">All</option>' + types.map(t => `<option value="${t}">${t}</option>`).join('');

  const procSel = document.getElementById('filterProcess');
  procSel.innerHTML = '<option value="">All</option>' + processes.map(p => `<option value="${p}">${p}</option>`).join('');

  const bomSel = document.getElementById('filterBom');
  bomSel.innerHTML = '<option value="">All</option>' + boms.map(b => `<option value="${b}">${b}</option>`).join('');
}

// ========== TABLE RENDERING ==========
function getFilteredItems() {
  const search = (document.getElementById('filterSearch').value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('filterType').value;
  const processFilter = document.getElementById('filterProcess').value;
  const bomFilter = document.getElementById('filterBom').value;

  return dashItems.filter(item => {
    if (search && !(item.name || '').toLowerCase().includes(search)) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (processFilter && item.process_step !== processFilter) return false;
    if (bomFilter && item.bom_category !== bomFilter) return false;
    return true;
  });
}

function sortItems(items) {
  return items.sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'number' && typeof vb === 'number') {
      return sortAsc ? va - vb : vb - va;
    }
    va = String(va).toLowerCase();
    vb = String(vb).toLowerCase();
    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

function renderTable() {
  const filtered = getFilteredItems();
  const sorted = sortItems(filtered);
  const tbody = document.getElementById('itemsBody');

  // Update sort arrows in header
  document.querySelectorAll('.items-table th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === sortCol) {
      arrow.textContent = sortAsc ? '▲' : '▼';
    } else {
      arrow.textContent = '';
    }
  });

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="no-items">No items match filters</td></tr>';
    return;
  }

  let html = '';
  for (const item of sorted) {
    const isLow = item.reorder_point != null && item.quantity <= item.reorder_point;
    const cost = item.cost_per_unit != null ? '$' + item.cost_per_unit.toFixed(2) : '—';
    html += `<tr class="clickable${isLow ? ' low-stock' : ''}" data-id="${item.id}" onclick="openUpdateItem('${item.id}')">
      <td><strong>${item.name || ''}</strong></td>
      <td>${item.type || item.category || ''}</td>
      <td>${item.process_step || ''}</td>
      <td style="text-align:right">${item.quantity != null ? item.quantity.toFixed(2) : '—'}</td>
      <td>${item.unit || ''}</td>
      <td style="text-align:right">${cost}</td>
      <td>${item.supplier || ''}</td>
      <td>${item.bom_category || ''}</td>
      <td style="text-align:center"><button class="btn-sm" onclick="event.stopPropagation();toggleLots('${item.id}')" style="font-size:9px;padding:1px 5px">lots</button></td>
    </tr>`;

    // Lots sub-row (hidden by default, shown when expanded)
    if (expandedItemId === item.id) {
      html += `<tr class="lots-subrow" id="lots-${item.id}"><td colspan="9"><div id="lotsContent-${item.id}">Loading lots...</div></td></tr>`;
    }
  }
  tbody.innerHTML = html;

  // If a lots row was just expanded, load its data
  if (expandedItemId) {
    loadLotsInline(expandedItemId);
  }
}

// ========== SORT HANDLER ==========
document.querySelectorAll('.items-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
    renderTable();
  });
});

// ========== LOTS EXPAND ==========
function toggleLots(itemId) {
  if (expandedItemId === itemId) {
    expandedItemId = null;
  } else {
    expandedItemId = itemId;
  }
  renderTable();
}

async function loadLotsInline(itemId) {
  const el = document.getElementById('lotsContent-' + itemId);
  if (!el) return;
  try {
    const lots = await api.listLotsForItem(itemId);
    if (!lots || lots.length === 0) {
      el.innerHTML = '<em style="color:var(--fg2)">No lots recorded</em>';
      return;
    }
    const rows = lots.map(lot => {
      const rcvd = lot.received_date ? new Date(lot.received_date).toLocaleDateString() : '—';
      return `<tr>
        <td>${lot.lot_number}</td>
        <td>${lot.supplier || '—'}</td>
        <td>${rcvd}</td>
        <td style="text-align:right">${lot.qty_received.toFixed(2)}</td>
        <td style="text-align:right;font-weight:bold">${lot.qty_remaining.toFixed(2)}</td>
        <td>${lot.notes || ''}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <table class="lots-table">
        <thead><tr><th>Lot #</th><th>Supplier</th><th>Received</th><th style="text-align:right">Qty Rcvd</th><th style="text-align:right">Remaining</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<em style="color:var(--red)">Failed: ${e.message}</em>`;
  }
}

// ========== LOW STOCK ==========
function renderLowStock() {
  const section = document.getElementById('lowStockSection');
  const list = document.getElementById('lowStockList');
  if (!dashLowStock.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  list.innerHTML = dashLowStock.map(item => `
    <div class="item">
      <span class="name">${item.name}</span>
      <span class="detail">${item.quantity.toFixed(2)} ${item.unit} (reorder at ${item.reorder_point})</span>
    </div>
  `).join('');
}

// ========== MODAL ACTIONS ==========
function dashAction(action) {
  const modal = document.getElementById('modalInventory');
  modal.classList.remove('hidden');
  // Ensure invCache is populated for the forms
  if (typeof invCache !== 'undefined') invCache.items = dashItems;
  showInvAction(action);
}

function closeDashModal() {
  document.getElementById('modalInventory').classList.add('hidden');
  // Refresh dashboard after modal closes (item may have been added/updated)
  loadDashboard();
}

function openUpdateItem(itemId) {
  dashAction('update_item');
  // Wait for the form to render, then select the item
  setTimeout(() => {
    const sel = document.getElementById('uiItemSelect');
    if (sel) {
      sel.value = itemId;
      loadUpdateItemFields();
    }
  }, 50);
}

// ========== API SETTINGS ==========
document.getElementById('btnApiSettingsDash').addEventListener('click', () => {
  document.getElementById('settApiUrl').value = getApiUrl();
  document.getElementById('settApiKey').value = getApiKey();
  document.getElementById('modalSettings').classList.remove('hidden');
});

// ========== TAB SWITCHING ==========
function switchDashTab(name) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.dtab === name));
  document.querySelectorAll('.dash-tab-content').forEach(c => c.classList.toggle('active', c.id === 'dtab-' + name));
  if (name === 'reorder') loadReorder();
  if (name === 'activity') {
    populateActivityItemFilter();
    loadActivity(0);
  }
}

// ========== REORDER TAB ==========
async function loadReorder() {
  if (!isApiConfigured()) {
    document.getElementById('reorderBody').innerHTML = '<tr><td colspan="9" class="no-items">API not configured.</td></tr>';
    return;
  }
  const wsel = document.getElementById('reorderWindowDays');
  reorderWindowDays = wsel ? parseInt(wsel.value, 10) || 30 : 30;
  document.getElementById('reorderBody').innerHTML = '<tr><td colspan="9" class="no-items">Loading consumption stats...</td></tr>';
  try {
    const stats = await api.consumptionStats(reorderWindowDays);
    // Merge stats with full item data so we have supplier/unit
    const itemMap = new Map(dashItems.map(i => [i.id, i]));
    reorderRows = stats.map(s => {
      const item = itemMap.get(s.inventory_item_id) || {};
      const dailyUse = s.daily_use || 0;
      const onHand = s.quantity != null ? s.quantity : 0;
      const reorderPoint = s.reorder_point;
      const leadTime = s.lead_time_days;
      const daysRemaining = dailyUse > 0 ? onHand / dailyUse : null;

      let status = 'ok';
      if (dailyUse <= 0 && (s.txn_count || 0) === 0) {
        status = 'nodata';
      } else if (onHand <= 0) {
        status = 'stockout';
      } else if (leadTime != null && daysRemaining != null && daysRemaining < leadTime) {
        status = 'critical';
      } else if (reorderPoint != null && onHand <= reorderPoint) {
        status = 'critical';
      } else if (leadTime != null && daysRemaining != null && daysRemaining < leadTime * 1.5) {
        status = 'soon';
      } else if (reorderPoint != null && onHand <= reorderPoint * 1.25) {
        status = 'soon';
      }

      // Suggested order date offset
      let suggestedDays = null;
      if (status === 'stockout' || status === 'critical') {
        suggestedDays = 0;
      } else if (status === 'soon' && leadTime != null && daysRemaining != null) {
        suggestedDays = Math.max(0, Math.round(daysRemaining - leadTime));
      }

      return {
        id: s.inventory_item_id,
        name: s.name,
        unit: s.unit || (item.unit || ''),
        supplier: item.supplier || '',
        quantity: onHand,
        daily_use: dailyUse,
        days_remaining: daysRemaining,
        lead_time_days: leadTime,
        reorder_point: reorderPoint,
        status,
        status_rank: { stockout: 0, critical: 1, soon: 2, ok: 3, nodata: 4 }[status],
        suggested_days: suggestedDays,
      };
    });
    renderReorder();
  } catch (e) {
    document.getElementById('reorderBody').innerHTML = `<tr><td colspan="9" class="no-items" style="color:var(--red)">Failed: ${e.message}</td></tr>`;
  }
}

function sortReorder(rows) {
  return rows.sort((a, b) => {
    let col = reorderSortCol;
    if (col === 'status') col = 'status_rank';
    let va = a[col], vb = b[col];
    if (va == null) va = (typeof vb === 'number') ? Infinity : '';
    if (vb == null) vb = (typeof va === 'number') ? Infinity : '';
    if (typeof va === 'number' && typeof vb === 'number') {
      return reorderSortAsc ? va - vb : vb - va;
    }
    va = String(va).toLowerCase();
    vb = String(vb).toLowerCase();
    return reorderSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

function renderReorder() {
  const hideOk = document.getElementById('reorderHideOk').checked;
  let rows = reorderRows;
  if (hideOk) rows = rows.filter(r => r.status !== 'ok');
  rows = sortReorder([...rows]);

  const STATUS_LABEL = {
    stockout: 'STOCKOUT', critical: 'CRITICAL', soon: 'SOON', ok: 'OK', nodata: 'NO DATA',
  };
  const fmtNum = (v, d = 1) => v == null || isNaN(v) ? '—' : v.toFixed(d);
  const fmtDays = v => v == null || isNaN(v) ? '—' : (v > 999 ? '>999' : v.toFixed(0));

  if (rows.length === 0) {
    document.getElementById('reorderBody').innerHTML = '<tr><td colspan="9" class="no-items">No items match.</td></tr>';
    return;
  }
  document.getElementById('reorderBody').innerHTML = rows.map(r => {
    let suggested = '—';
    if (r.suggested_days === 0) {
      suggested = '<span style="color:var(--red);font-weight:bold">order today</span>';
    } else if (r.suggested_days != null && r.suggested_days > 0) {
      suggested = `within ~${r.suggested_days}d`;
    }
    return `<tr>
      <td><span class="reorder-status ${r.status}">${STATUS_LABEL[r.status]}</span></td>
      <td><strong>${r.name}</strong></td>
      <td style="font-size:10px;color:var(--fg2)">${r.supplier || '—'}</td>
      <td style="text-align:right">${fmtNum(r.quantity, 2)} ${r.unit}</td>
      <td style="text-align:right">${fmtNum(r.daily_use, 3)} /d</td>
      <td style="text-align:right">${fmtDays(r.days_remaining)}</td>
      <td style="text-align:right"><input type="number" class="inline-edit" value="${r.lead_time_days != null ? r.lead_time_days : ''}" data-rid="${r.id}" data-rfield="lead_time_days" placeholder="—"></td>
      <td style="text-align:right"><input type="number" class="inline-edit" value="${r.reorder_point != null ? r.reorder_point : ''}" data-rid="${r.id}" data-rfield="reorder_point" placeholder="—" step="any"></td>
      <td>${suggested}</td>
    </tr>`;
  }).join('');

  // Wire inline edits
  document.querySelectorAll('#reorderBody input.inline-edit').forEach(inp => {
    inp.addEventListener('change', async () => {
      const rid = inp.dataset.rid;
      const field = inp.dataset.rfield;
      const value = inp.value === '' ? null
        : (field === 'lead_time_days' ? parseInt(inp.value, 10) : parseFloat(inp.value));
      try {
        await api.updateInventoryItem(rid, { [field]: value });
        // Patch local row
        const row = reorderRows.find(r => r.id === rid);
        if (row) row[field] = value;
        const inv = dashItems.find(i => i.id === rid);
        if (inv) inv[field] = value;
        // Recompute and re-render so status flags update
        await loadReorder();
      } catch (e) { showToast('Update failed: ' + e.message, true); }
    });
  });

  // Update sort arrows in header
  document.querySelectorAll('.reorder-table th[data-sort-reorder]').forEach(th => {
    if (th.dataset.sortReorder === reorderSortCol) {
      th.style.color = 'var(--fg)';
    } else {
      th.style.color = '';
    }
  });
}

// Header click → sort
document.querySelectorAll('.reorder-table th[data-sort-reorder]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sortReorder;
    if (reorderSortCol === col) reorderSortAsc = !reorderSortAsc;
    else { reorderSortCol = col; reorderSortAsc = true; }
    renderReorder();
  });
});

// ========== ACTIVITY TAB ==========
function populateActivityItemFilter() {
  const sel = document.getElementById('activityItem');
  if (!sel) return;
  const cur = sel.value;
  // Sort items alphabetically
  const sorted = [...dashItems].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">All</option>' +
    sorted.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  if (cur) sel.value = cur;
}

async function loadActivity(offset) {
  if (!isApiConfigured()) {
    document.getElementById('activityBody').innerHTML = '<tr><td colspan="7" class="no-items">API not configured.</td></tr>';
    return;
  }
  if (offset < 0) offset = 0;
  activityOffset = offset;
  document.getElementById('activityBody').innerHTML = '<tr><td colspan="7" class="no-items">Loading...</td></tr>';
  const reason = document.getElementById('activityReason').value || null;
  const itemId = document.getElementById('activityItem').value || null;
  const sinceVal = document.getElementById('activitySince').value;
  const since = sinceVal ? new Date(sinceVal).toISOString() : null;
  try {
    const rows = await api.listAllTransactions({
      limit: activityLimit + 1,  // request one extra to detect "has more"
      offset,
      item_id: itemId,
      reason,
      since,
    });
    const hasMore = rows.length > activityLimit;
    activityRows = hasMore ? rows.slice(0, activityLimit) : rows;
    renderActivity(hasMore);
  } catch (e) {
    document.getElementById('activityBody').innerHTML = `<tr><td colspan="7" class="no-items" style="color:var(--red)">Failed: ${e.message}</td></tr>`;
  }
}

function renderActivity(hasMore) {
  if (activityRows.length === 0) {
    document.getElementById('activityBody').innerHTML = '<tr><td colspan="7" class="no-items">No transactions match.</td></tr>';
    document.getElementById('activityRange').textContent = '0 results';
    document.getElementById('activityPrev').disabled = activityOffset === 0;
    document.getElementById('activityNext').disabled = true;
    return;
  }
  document.getElementById('activityBody').innerHTML = activityRows.map(t => {
    const when = t.created_at ? new Date(t.created_at).toLocaleString() : '—';
    const qty = t.qty_change > 0 ? '+' + t.qty_change.toFixed(2) : t.qty_change.toFixed(2);
    const reason = t.reason || '';
    const noteParts = [t.batch_id ? `batch ${t.batch_id}` : null, t.notes].filter(Boolean);
    return `<tr>
      <td style="white-space:nowrap;font-size:10px;color:var(--fg2)">${when}</td>
      <td><span class="activity-reason ${reason}">${reason}</span></td>
      <td><strong>${t.inventory_item_name || '—'}</strong></td>
      <td style="font-size:10px;color:var(--fg2)">${t.lot_number || '—'}</td>
      <td style="text-align:right;font-weight:bold;color:${t.qty_change >= 0 ? 'var(--accent)' : 'var(--red)'}">${qty}</td>
      <td style="font-size:10px;color:var(--fg2)">${noteParts.join(' • ')}</td>
      <td style="font-size:10px;color:var(--fg2)">${t.performed_by || '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('activityRange').textContent =
    `${activityOffset + 1}–${activityOffset + activityRows.length}` +
    (hasMore ? ' (more)' : '');
  document.getElementById('activityPrev').disabled = activityOffset === 0;
  document.getElementById('activityNext').disabled = !hasMore;
}

// ========== INIT ==========
loadDashboard();
