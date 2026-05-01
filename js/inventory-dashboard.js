// ========== INVENTORY DASHBOARD ==========
// Standalone table/sort/filter logic for inventory.html
// Reuses modals from inventory-ui.js (Add, Update, Receive, Count)

let dashItems = [];
let dashLowStock = [];
let sortCol = 'name';
let sortAsc = true;
let expandedItemId = null;  // which item has lots sub-row open

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

// ========== INIT ==========
loadDashboard();
