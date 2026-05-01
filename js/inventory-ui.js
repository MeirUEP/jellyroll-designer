// ========== INVENTORY UI ==========
// Modal with dropdown switcher between 5 purpose-built forms:
//   1. Add new inventory item
//   2. Receive shipment
//   3. Update physical count
//   4. Enter product recipe
//   5. Log production

const INV_CATEGORIES = ['raw_chemical', 'separator', 'collector', 'tab', 'tape', 'electrolyte', 'finished_good', 'packaging', 'electronics', 'other'];
const INV_UNITS = ['kg', 'lbs', 'g', 'L', 'mL', 'ft', 'm', 'in', 'mm', 'LM', 'Lf', 'pcs', 'rolls'];
const INV_PACKAGE_UNITS = ['', 'bag', 'supersack', 'roll', 'drum', 'tote', 'jar', 'bottle', 'box', 'case', 'pallet'];
const INV_LOCATIONS = ['warehouse', 'production', 'lab', 'shipping'];

// Cached data loaded when modal opens
let invCache = {
  items: [],
  products: [],
};

function openInventoryModal() {
  if (!isApiConfigured()) {
    showToast('API not configured — set API URL & Key in settings', true);
    return;
  }
  const modal = document.getElementById('modalInventory');
  modal.classList.remove('hidden');
  // Load items for dropdowns
  refreshInventoryCache().then(() => {
    // Default to showing the action picker
    showInvAction('');
  });
}

function closeInventoryModal() {
  document.getElementById('modalInventory').classList.add('hidden');
}

async function refreshInventoryCache() {
  // Load independently so one failure doesn't break the other
  try {
    invCache.items = (await api.listInventory()) || [];
  } catch (e) {
    console.error('Failed to load inventory items:', e);
    invCache.items = [];
    showToast('Failed to load inventory items', true);
  }
  try {
    invCache.products = (await api.listRecipeProducts()) || [];
  } catch (e) {
    // Recipes endpoint may not be deployed yet — OK
    console.warn('Recipe products not available:', e.message);
    invCache.products = [];
  }
}

function showInvAction(action) {
  // The dashboard's modal in inventory.html doesn't include the action-picker
  // dropdown (it has its own Action buttons), so guard this reference.
  const picker = document.getElementById('invActionPicker');
  if (picker) picker.value = action;
  const forms = ['invFormAddItem', 'invFormUpdateItem', 'invFormReceive', 'invFormCount', 'invFormRecipe', 'invFormProduction'];
  forms.forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('invStatus').textContent = '';

  if (action === 'add_item') {
    document.getElementById('invFormAddItem').style.display = 'block';
    renderAddItemForm();
  } else if (action === 'update_item') {
    document.getElementById('invFormUpdateItem').style.display = 'block';
    renderUpdateItemForm();
  } else if (action === 'receive') {
    document.getElementById('invFormReceive').style.display = 'block';
    renderReceiveForm();
  } else if (action === 'count') {
    document.getElementById('invFormCount').style.display = 'block';
    renderCountForm();
  } else if (action === 'recipe') {
    document.getElementById('invFormRecipe').style.display = 'block';
    renderRecipeForm();
  } else if (action === 'production') {
    document.getElementById('invFormProduction').style.display = 'block';
    renderProductionForm();
  }
}

// ========== 1. ADD NEW INVENTORY ITEM ==========
function renderAddItemForm() {
  const el = document.getElementById('invFormAddItem');
  el.innerHTML = `
    <h4>Add New Inventory Item</h4>
    <div class="inv-grid-2">
      <div class="inv-field">
        <label>Item name *</label>
        <input type="text" id="aiName" placeholder="e.g. Zinc Powder Lot A">
      </div>
      <div class="inv-field">
        <label>Category *</label>
        <select id="aiCategory" onchange="renderAddItemSpecs()">
          ${INV_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Unit *</label>
        <select id="aiUnit">
          ${INV_UNITS.map(u => `<option value="${u}">${u}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Supplier</label>
        <input type="text" id="aiSupplier" placeholder="primary supplier">
      </div>
      <div class="inv-field">
        <label>Package unit</label>
        <select id="aiPackageUnit">
          ${INV_PACKAGE_UNITS.map(u => `<option value="${u}">${u || '(none)'}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Package size (qty per package)</label>
        <input type="number" id="aiPackageSize" step="any" placeholder="e.g. 50">
      </div>
      <div class="inv-field">
        <label>Initial quantity</label>
        <input type="number" id="aiQty" step="any" value="0">
      </div>
      <div class="inv-field">
        <label>Location</label>
        <select id="aiLocation">
          ${INV_LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Reorder point</label>
        <input type="number" id="aiReorder" step="any" placeholder="alert below this">
      </div>
      <div class="inv-field">
        <label>Lead time (days)</label>
        <input type="number" id="aiLeadTime" step="1" placeholder="supplier lead time">
      </div>
      <div class="inv-field">
        <label>Cost per unit ($)</label>
        <input type="number" id="aiCost" step="any" placeholder="e.g. 12.50 per kg">
      </div>
      <div class="inv-field">
        <label>Lot number</label>
        <input type="text" id="aiLot">
      </div>
      <div class="inv-field inv-full">
        <label>Notes</label>
        <textarea id="aiNotes" rows="2"></textarea>
      </div>
    </div>
    <div id="aiSpecs" style="margin-top:10px"></div>
    <button class="btn-primary inv-submit" onclick="submitAddItem()">Add Item</button>
  `;
  renderAddItemSpecs();
}

// Show spec fields conditionally based on the selected category.
// Chemicals get density/capacity/active-material flag.
// Separators/collectors/tabs get thickness + width + color.
function renderAddItemSpecs() {
  const cat = document.getElementById('aiCategory').value;
  const wrap = document.getElementById('aiSpecs');
  if (!wrap) return;
  let html = '';
  if (cat === 'raw_chemical') {
    html = `
      <h4 style="margin-bottom:6px">Chemical specs</h4>
      <div class="inv-grid-2">
        <div class="inv-field">
          <label>Density (g/cm&sup3;)</label>
          <input type="number" id="aiDensity" step="any" placeholder="e.g. 1.32">
        </div>
        <div class="inv-field">
          <label>Capacity (mAh/g)</label>
          <input type="number" id="aiCapacity" step="any" placeholder="active materials only">
        </div>
        <div class="inv-field inv-full">
          <label><input type="checkbox" id="aiIsActive"> Active material (participates in capacity)</label>
        </div>
      </div>`;
  } else if (cat === 'separator' || cat === 'collector') {
    html = `
      <h4 style="margin-bottom:6px">${cat === 'separator' ? 'Separator' : 'Collector'} specs</h4>
      <div class="inv-grid-2">
        <div class="inv-field">
          <label>Thickness (mm)</label>
          <input type="number" id="aiThickness" step="any" placeholder="e.g. 0.05">
        </div>
        <div class="inv-field">
          <label>Width (mm)</label>
          <input type="number" id="aiWidth" step="any" placeholder="e.g. 200">
        </div>
        <div class="inv-field">
          <label>Color (for diagrams)</label>
          <input type="color" id="aiColor" value="#888888">
        </div>
      </div>`;
  } else if (cat === 'tab') {
    html = `
      <h4 style="margin-bottom:6px">Tab specs</h4>
      <div class="inv-grid-2">
        <div class="inv-field">
          <label>Thickness (mm)</label>
          <input type="number" id="aiThickness" step="any" placeholder="e.g. 0.127">
        </div>
        <div class="inv-field">
          <label>Color (for diagrams)</label>
          <input type="color" id="aiColor" value="#c0c0c0">
        </div>
      </div>`;
  }
  wrap.innerHTML = html;
}

async function submitAddItem() {
  const cat = document.getElementById('aiCategory').value;
  const data = {
    name: document.getElementById('aiName').value.trim(),
    category: cat,
    unit: document.getElementById('aiUnit').value,
    supplier: document.getElementById('aiSupplier').value.trim() || null,
    package_unit: document.getElementById('aiPackageUnit').value || null,
    package_size: parseFloat(document.getElementById('aiPackageSize').value) || null,
    quantity: parseFloat(document.getElementById('aiQty').value) || 0,
    location: document.getElementById('aiLocation').value,
    reorder_point: parseFloat(document.getElementById('aiReorder').value) || null,
    lead_time_days: parseInt(document.getElementById('aiLeadTime').value, 10) || null,
    cost_per_unit: parseFloat(document.getElementById('aiCost').value) || null,
    lot_number: document.getElementById('aiLot').value.trim() || null,
    notes: document.getElementById('aiNotes').value.trim() || null,
  };
  // Category-specific specs
  const specDensity = document.getElementById('aiDensity');
  const specCapacity = document.getElementById('aiCapacity');
  const specIsActive = document.getElementById('aiIsActive');
  const specThickness = document.getElementById('aiThickness');
  const specWidth = document.getElementById('aiWidth');
  const specColor = document.getElementById('aiColor');
  if (specDensity) data.density = parseFloat(specDensity.value) || null;
  if (specCapacity) data.capacity = parseFloat(specCapacity.value) || null;
  if (specIsActive) data.is_active_mat = specIsActive.checked;
  if (specThickness) data.thickness_mm = parseFloat(specThickness.value) || null;
  if (specWidth) data.width_mm = parseFloat(specWidth.value) || null;
  if (specColor) data.color = specColor.value || null;
  if (!data.name) { setInvStatus('Name is required', true); return; }

  try {
    const item = await api.createInventoryItem(data);
    setInvStatus(`Added "${item.name}" (qty: ${item.quantity} ${item.unit})`);
    await refreshInventoryCache();
    renderAddItemForm();
  } catch (e) {
    setInvStatus('Failed: ' + e.message, true);
  }
}

// ========== 2. UPDATE INVENTORY ITEM ==========
function renderUpdateItemForm() {
  const el = document.getElementById('invFormUpdateItem');
  const itemOpts = invCache.items
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(i => `<option value="${i.id}">${i.name}${i.supplier ? ' — ' + i.supplier : ''} [${i.category}]</option>`)
    .join('');
  el.innerHTML = `
    <h4>Update Inventory Item</h4>
    <div class="inv-grid-2">
      <div class="inv-field inv-full">
        <label>Select item *</label>
        <select id="uiItemSelect" onchange="loadUpdateItemFields()">
          <option value="">-- Select item --</option>
          ${itemOpts}
        </select>
      </div>
    </div>
    <div id="uiFieldsWrap" style="margin-top:10px"></div>
  `;
}

function loadUpdateItemFields() {
  const id = document.getElementById('uiItemSelect').value;
  const wrap = document.getElementById('uiFieldsWrap');
  if (!id) { wrap.innerHTML = ''; return; }
  const item = invCache.items.find(i => i.id === id);
  if (!item) { wrap.innerHTML = ''; return; }

  const cat = item.category || 'other';

  // Build spec fields based on category
  let specHtml = '';
  if (cat === 'raw_chemical') {
    specHtml = `
      <h4 style="margin-bottom:6px">Chemical specs</h4>
      <div class="inv-grid-2">
        <div class="inv-field">
          <label>Density (g/cm&sup3;)</label>
          <input type="number" id="uiDensity" step="any" value="${item.density || ''}">
        </div>
        <div class="inv-field">
          <label>Capacity (mAh/g)</label>
          <input type="number" id="uiCapacity" step="any" value="${item.capacity || ''}">
        </div>
        <div class="inv-field inv-full">
          <label><input type="checkbox" id="uiIsActive" ${item.is_active_mat ? 'checked' : ''}> Active material (participates in capacity)</label>
        </div>
      </div>`;
  } else if (cat === 'separator' || cat === 'collector') {
    specHtml = `
      <h4 style="margin-bottom:6px">${cat === 'separator' ? 'Separator' : 'Collector'} specs</h4>
      <div class="inv-grid-2">
        <div class="inv-field">
          <label>Thickness (mm)</label>
          <input type="number" id="uiThickness" step="any" value="${item.thickness_mm || ''}">
        </div>
        <div class="inv-field">
          <label>Width (mm)</label>
          <input type="number" id="uiWidth" step="any" value="${item.width_mm || ''}">
        </div>
        <div class="inv-field">
          <label>Color (for diagrams)</label>
          <input type="color" id="uiColor" value="${item.color || '#888888'}">
        </div>
      </div>`;
  } else if (cat === 'tab') {
    specHtml = `
      <h4 style="margin-bottom:6px">Tab specs</h4>
      <div class="inv-grid-2">
        <div class="inv-field">
          <label>Thickness (mm)</label>
          <input type="number" id="uiThickness" step="any" value="${item.thickness_mm || ''}">
        </div>
        <div class="inv-field">
          <label>Color (for diagrams)</label>
          <input type="color" id="uiColor" value="${item.color || '#c0c0c0'}">
        </div>
      </div>`;
  }

  wrap.innerHTML = `
    <div class="inv-grid-2">
      <div class="inv-field">
        <label>Item name *</label>
        <input type="text" id="uiName" value="${item.name || ''}">
      </div>
      <div class="inv-field">
        <label>Category *</label>
        <select id="uiCategory">
          ${INV_CATEGORIES.map(c => `<option value="${c}" ${c === cat ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Unit *</label>
        <select id="uiUnit">
          ${INV_UNITS.map(u => `<option value="${u}" ${u === item.unit ? 'selected' : ''}>${u}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Supplier</label>
        <input type="text" id="uiSupplier" value="${item.supplier || ''}">
      </div>
      <div class="inv-field">
        <label>Package unit</label>
        <select id="uiPackageUnit">
          ${INV_PACKAGE_UNITS.map(u => `<option value="${u}" ${u === (item.package_unit || '') ? 'selected' : ''}>${u || '(none)'}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Package size (qty per package)</label>
        <input type="number" id="uiPackageSize" step="any" value="${item.package_size || ''}">
      </div>
      <div class="inv-field">
        <label>Current quantity</label>
        <input type="number" id="uiQty" step="any" value="${item.quantity || 0}">
      </div>
      <div class="inv-field">
        <label>Location</label>
        <select id="uiLocation">
          ${INV_LOCATIONS.map(l => `<option value="${l}" ${l === item.location ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="inv-field">
        <label>Reorder point</label>
        <input type="number" id="uiReorder" step="any" value="${item.reorder_point || ''}">
      </div>
      <div class="inv-field">
        <label>Lead time (days)</label>
        <input type="number" id="uiLeadTime" step="1" value="${item.lead_time_days || ''}" placeholder="supplier lead time">
      </div>
      <div class="inv-field">
        <label>Cost per unit ($)</label>
        <input type="number" id="uiCost" step="any" value="${item.cost_per_unit || ''}">
      </div>
      <div class="inv-field">
        <label>Lot number</label>
        <input type="text" id="uiLot" value="${item.lot_number || ''}">
      </div>
      <div class="inv-field inv-full">
        <label>Notes</label>
        <textarea id="uiNotes" rows="2">${item.notes || ''}</textarea>
      </div>
    </div>
    <div id="uiSpecs" style="margin-top:10px">${specHtml}</div>
    <button class="btn-primary inv-submit" onclick="submitUpdateItem()">Update Item</button>
    <div id="uiLotsWrap" style="margin-top:12px"></div>
  `;
  loadLotsForItem(id);
}

async function loadLotsForItem(itemId) {
  const wrap = document.getElementById('uiLotsWrap');
  if (!wrap || !itemId) return;
  wrap.innerHTML = '<p style="color:var(--fg2);font-size:10px">Loading lots...</p>';
  try {
    const lots = await api.listLotsForItem(itemId);
    if (!lots || lots.length === 0) {
      wrap.innerHTML = '<p style="color:var(--fg2);font-size:10px">No lots recorded for this item.</p>';
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
      </tr>`;
    }).join('');
    const totalRemaining = lots.reduce((s, l) => s + l.qty_remaining, 0);
    wrap.innerHTML = `
      <h4 style="font-size:11px;margin-bottom:4px;border-top:1px solid var(--border,#333);padding-top:8px">
        Lots (${lots.length}) — Total remaining: ${totalRemaining.toFixed(2)}
      </h4>
      <table class="inv-preview-table" style="font-size:10px">
        <thead><tr><th>Lot #</th><th>Supplier</th><th>Received</th><th style="text-align:right">Qty Rcvd</th><th style="text-align:right">Remaining</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (e) {
    wrap.innerHTML = `<p style="color:#ef4444;font-size:10px">Failed to load lots: ${e.message}</p>`;
  }
}

async function submitUpdateItem() {
  const id = document.getElementById('uiItemSelect').value;
  if (!id) { setInvStatus('Select an item first', true); return; }

  const data = {
    name: document.getElementById('uiName').value.trim(),
    category: document.getElementById('uiCategory').value,
    unit: document.getElementById('uiUnit').value,
    supplier: document.getElementById('uiSupplier').value.trim() || null,
    package_unit: document.getElementById('uiPackageUnit').value || null,
    package_size: parseFloat(document.getElementById('uiPackageSize').value) || null,
    quantity: parseFloat(document.getElementById('uiQty').value) || 0,
    location: document.getElementById('uiLocation').value,
    reorder_point: parseFloat(document.getElementById('uiReorder').value) || null,
    lead_time_days: parseInt(document.getElementById('uiLeadTime').value, 10) || null,
    cost_per_unit: parseFloat(document.getElementById('uiCost').value) || null,
    lot_number: document.getElementById('uiLot').value.trim() || null,
    notes: document.getElementById('uiNotes').value.trim() || null,
  };
  if (!data.name) { setInvStatus('Name is required', true); return; }

  // Category-specific specs
  const specDensity = document.getElementById('uiDensity');
  const specCapacity = document.getElementById('uiCapacity');
  const specIsActive = document.getElementById('uiIsActive');
  const specThickness = document.getElementById('uiThickness');
  const specWidth = document.getElementById('uiWidth');
  const specColor = document.getElementById('uiColor');
  if (specDensity) data.density = parseFloat(specDensity.value) || null;
  if (specCapacity) data.capacity = parseFloat(specCapacity.value) || null;
  if (specIsActive) data.is_active_mat = specIsActive.checked;
  if (specThickness) data.thickness_mm = parseFloat(specThickness.value) || null;
  if (specWidth) data.width_mm = parseFloat(specWidth.value) || null;
  if (specColor) data.color = specColor.value || null;

  try {
    const updated = await api.updateInventoryItem(id, data);
    setInvStatus(`Updated "${updated.name}"`);
    await refreshInventoryCache();
    // Refresh the global inventory so formulation dropdowns reflect changes
    await refreshInventory();
    // Re-render to update the dropdown with fresh data but keep selection
    renderUpdateItemForm();
    // Re-select the item that was just updated
    const sel = document.getElementById('uiItemSelect');
    if (sel) { sel.value = id; loadUpdateItemFields(); }
  } catch (e) {
    setInvStatus('Failed: ' + e.message, true);
  }
}

// ========== 3. RECEIVE SHIPMENT ==========
function renderReceiveForm() {
  const el = document.getElementById('invFormReceive');
  const itemOpts = invCache.items.map(i => `<option value="${i.id}">${i.name}${i.supplier ? ' — ' + i.supplier : ''} (current: ${i.quantity} ${i.unit})</option>`).join('');
  el.innerHTML = `
    <h4>Receive Shipment</h4>
    <div class="inv-grid-2">
      <div class="inv-field inv-full">
        <label>Item *</label>
        <select id="rsItem">
          <option value="">-- Select item --</option>
          ${itemOpts}
        </select>
      </div>
      <div class="inv-field">
        <label>Quantity received *</label>
        <input type="number" id="rsQty" step="any" placeholder="e.g. 100">
      </div>
      <div class="inv-field">
        <label>Lot number</label>
        <input type="text" id="rsLot" placeholder="optional — blank = unspecified">
      </div>
      <div class="inv-field">
        <label>Supplier</label>
        <input type="text" id="rsSupplier" placeholder="who shipped this lot">
      </div>
      <div class="inv-field">
        <label>Received by</label>
        <input type="text" id="rsBy" placeholder="your name">
      </div>
      <div class="inv-field inv-full">
        <label>Notes</label>
        <textarea id="rsNotes" rows="2" placeholder="PO #, supplier, etc."></textarea>
      </div>
    </div>
    <button class="btn-primary inv-submit" onclick="submitReceive()">Record Shipment</button>
  `;
}

async function submitReceive() {
  const itemId = document.getElementById('rsItem').value;
  const qty = parseFloat(document.getElementById('rsQty').value);
  if (!itemId) { setInvStatus('Select an item', true); return; }
  if (!qty || qty <= 0) { setInvStatus('Quantity must be > 0', true); return; }

  const data = {
    inventory_item_id: itemId,
    qty: qty,
    lot_number: document.getElementById('rsLot').value.trim() || null,
    supplier: document.getElementById('rsSupplier').value.trim() || null,
    performed_by: document.getElementById('rsBy').value.trim() || null,
    notes: document.getElementById('rsNotes').value.trim() || null,
  };
  try {
    const txn = await api.receiveShipment(data);
    const item = invCache.items.find(i => i.id === itemId);
    const lotNote = data.lot_number ? ` → lot "${data.lot_number}"` : ' → unspecified lot';
    setInvStatus(`Received ${qty} ${item.unit} of ${item.name}${lotNote}`);
    await refreshInventoryCache();
    renderReceiveForm();
  } catch (e) {
    setInvStatus('Failed: ' + e.message, true);
  }
}

// ========== 3. UPDATE PHYSICAL COUNT ==========
function renderCountForm() {
  const el = document.getElementById('invFormCount');
  const itemOpts = invCache.items.map(i => `<option value="${i.id}" data-qty="${i.quantity}" data-unit="${i.unit}">${i.name}</option>`).join('');
  el.innerHTML = `
    <h4>Update Physical Count</h4>
    <p class="inv-help">Record what you actually counted. The system will log the difference as an adjustment.</p>
    <div class="inv-grid-2">
      <div class="inv-field inv-full">
        <label>Item *</label>
        <select id="pcItem" onchange="updateCountCurrent()">
          <option value="">-- Select item --</option>
          ${itemOpts}
        </select>
      </div>
      <div class="inv-field">
        <label>Current (system) qty</label>
        <input type="text" id="pcCurrent" readonly style="background:var(--bg-secondary,#2a2a2a);color:var(--fg2)">
      </div>
      <div class="inv-field">
        <label>Counted qty *</label>
        <input type="number" id="pcCounted" step="any">
      </div>
      <div class="inv-field">
        <label>Counted by</label>
        <input type="text" id="pcBy">
      </div>
      <div class="inv-field inv-full">
        <label>Notes</label>
        <textarea id="pcNotes" rows="2"></textarea>
      </div>
    </div>
    <button class="btn-primary inv-submit" onclick="submitCount()">Record Count</button>
  `;
}

function updateCountCurrent() {
  const sel = document.getElementById('pcItem');
  const opt = sel.options[sel.selectedIndex];
  const qty = opt.getAttribute('data-qty') || '';
  const unit = opt.getAttribute('data-unit') || '';
  document.getElementById('pcCurrent').value = qty ? `${qty} ${unit}` : '';
}

async function submitCount() {
  const itemId = document.getElementById('pcItem').value;
  const counted = parseFloat(document.getElementById('pcCounted').value);
  if (!itemId) { setInvStatus('Select an item', true); return; }
  if (isNaN(counted)) { setInvStatus('Enter counted quantity', true); return; }

  const data = {
    inventory_item_id: itemId,
    counted_qty: counted,
    performed_by: document.getElementById('pcBy').value.trim() || null,
    notes: document.getElementById('pcNotes').value.trim() || null,
  };
  try {
    await api.physicalCount(data);
    const item = invCache.items.find(i => i.id === itemId);
    const diff = counted - item.quantity;
    setInvStatus(`Count recorded for ${item.name}: was ${item.quantity}, now ${counted} (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`);
    await refreshInventoryCache();
    renderCountForm();
  } catch (e) {
    setInvStatus('Failed: ' + e.message, true);
  }
}

// ========== 4. PRODUCT RECIPE ==========
let recipeLines = [];

function renderRecipeForm() {
  const el = document.getElementById('invFormRecipe');
  const productOpts = invCache.products.map(p => `<option value="${p}">${p}</option>`).join('');
  el.innerHTML = `
    <h4>Product Recipe</h4>
    <p class="inv-help">Define what goes into one unit of a product. Each row is one component.</p>
    <div class="inv-grid-2">
      <div class="inv-field inv-full">
        <label>Product name *</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="text" id="rpProduct" placeholder="e.g. Rev 5 Anode Batch" list="rpProductList" style="flex:1">
          <datalist id="rpProductList">${productOpts}</datalist>
          <button class="btn-sm" type="button" onclick="loadExistingRecipe()">Load</button>
        </div>
      </div>
    </div>
    <div id="recipeLinesWrap" style="margin-top:8px"></div>
    <button class="btn-sm" type="button" onclick="addRecipeLineRow()" style="margin-top:4px">+ Add Component</button>
    <button class="btn-primary inv-submit" onclick="submitRecipe()">Save Recipe</button>
  `;
  recipeLines = [];
  addRecipeLineRow();
  addRecipeLineRow();
  addRecipeLineRow();
}

async function loadExistingRecipe() {
  const product = document.getElementById('rpProduct').value.trim();
  if (!product) { setInvStatus('Enter a product name first', true); return; }
  try {
    const lines = await api.listRecipes(product);
    if (!lines.length) { setInvStatus(`No existing recipe for "${product}"`, true); return; }
    recipeLines = lines.map(l => ({ component: l.component, qty: l.qty, unit: l.unit, notes: l.notes || '' }));
    renderRecipeLines();
    setInvStatus(`Loaded ${lines.length} component(s) for "${product}"`);
  } catch (e) {
    setInvStatus('Failed to load: ' + e.message, true);
  }
}

function addRecipeLineRow() {
  recipeLines.push({ component: '', qty: '', unit: '', notes: '' });
  renderRecipeLines();
}

function removeRecipeLine(i) {
  recipeLines.splice(i, 1);
  renderRecipeLines();
}

function renderRecipeLines() {
  const wrap = document.getElementById('recipeLinesWrap');
  if (!wrap) return;
  const compOpts = invCache.items.map(i => `<option value="${i.name}">${i.name}</option>`).join('');
  const unitOpts = INV_UNITS.map(u => `<option value="${u}">${u}</option>`).join('');

  wrap.innerHTML = `
    <div class="recipe-header">
      <div>Component</div>
      <div>Qty per unit</div>
      <div>Unit</div>
      <div>Notes</div>
      <div></div>
    </div>
    ${recipeLines.map((line, i) => `
      <div class="recipe-row">
        <input type="text" list="rcComponents" value="${line.component || ''}" onchange="recipeLines[${i}].component=this.value">
        <input type="number" step="any" value="${line.qty}" onchange="recipeLines[${i}].qty=this.value">
        <select onchange="recipeLines[${i}].unit=this.value">
          <option value="">--</option>
          ${INV_UNITS.map(u => `<option value="${u}" ${line.unit===u?'selected':''}>${u}</option>`).join('')}
        </select>
        <input type="text" value="${line.notes || ''}" onchange="recipeLines[${i}].notes=this.value" placeholder="optional">
        <button class="btn-sm btn-remove" type="button" onclick="removeRecipeLine(${i})">&times;</button>
      </div>
    `).join('')}
    <datalist id="rcComponents">${compOpts}</datalist>
  `;
}

async function submitRecipe() {
  const product = document.getElementById('rpProduct').value.trim();
  if (!product) { setInvStatus('Enter a product name', true); return; }
  const valid = recipeLines
    .filter(l => l.component && l.qty && l.unit)
    .map(l => ({ component: l.component.trim(), qty: parseFloat(l.qty), unit: l.unit, notes: l.notes || null }));
  if (!valid.length) { setInvStatus('Add at least one component', true); return; }

  // Warn if any component names don't match inventory
  const names = new Set(invCache.items.map(i => i.name));
  const missing = valid.filter(l => !names.has(l.component)).map(l => l.component);
  if (missing.length) {
    if (!confirm(`These components are not in inventory and won't be deducted during production:\n\n${missing.join('\n')}\n\nSave recipe anyway?`)) return;
  }

  try {
    await api.saveRecipeBulk({ product, lines: valid });
    setInvStatus(`Saved recipe for "${product}" (${valid.length} components)`);
    await refreshInventoryCache();
  } catch (e) {
    setInvStatus('Failed: ' + e.message, true);
  }
}

// ========== 5. PRODUCTION LOG ==========
function renderProductionForm() {
  const el = document.getElementById('invFormProduction');
  const productOpts = invCache.products.map(p => `<option value="${p}">${p}</option>`).join('');
  el.innerHTML = `
    <h4>Log Production</h4>
    <p class="inv-help">Record how many of a product you made. Inventory will be deducted based on the saved recipe.</p>
    <div class="inv-grid-2">
      <div class="inv-field">
        <label>Product *</label>
        <select id="plProduct" onchange="previewProduction()">
          <option value="">-- Select product --</option>
          ${productOpts}
        </select>
      </div>
      <div class="inv-field">
        <label>Quantity produced *</label>
        <input type="number" id="plQty" step="any" oninput="previewProduction()">
      </div>
      <div class="inv-field">
        <label>Batch ID</label>
        <input type="text" id="plBatch" placeholder="optional reference">
      </div>
      <div class="inv-field">
        <label>Performed by</label>
        <input type="text" id="plBy">
      </div>
      <div class="inv-field">
        <label>Production date</label>
        <input type="date" id="plDate" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="inv-field inv-full">
        <label>Notes</label>
        <textarea id="plNotes" rows="2"></textarea>
      </div>
    </div>
    <div id="plPreview" class="inv-preview"></div>
    <button class="btn-primary inv-submit" onclick="submitProduction()">Log Production & Deduct Inventory</button>
  `;
}

let productionSelections = {};

async function previewProduction() {
  const product = document.getElementById('plProduct').value;
  const qty = parseFloat(document.getElementById('plQty').value);
  const preview = document.getElementById('plPreview');
  if (!product || !qty || qty <= 0) { preview.innerHTML = ''; return; }
  try {
    const lines = await api.listRecipes(product);
    if (!lines.length) { preview.innerHTML = '<em>No recipe found.</em>'; return; }

    let options = {};
    try { options = await api.componentOptions(product); } catch (e) { /* fall back to simple mode */ }

    const rows = lines.map(l => {
      const willConsume = l.qty * qty;
      const alternatives = options[l.component] || [];

      let supplierHtml = '';
      if (alternatives.length > 1) {
        const selected = productionSelections[l.component] || (alternatives[0] ? alternatives[0].id : '');
        const opts = alternatives.map(alt =>
          `<option value="${alt.id}" ${alt.id === selected ? 'selected' : ''}>${alt.name}${alt.supplier ? ' — ' + alt.supplier : ''} (${alt.quantity.toFixed(1)} ${alt.unit})</option>`
        ).join('');
        supplierHtml = `<select class="pl-supplier-pick" data-component="${l.component}" onchange="productionSelections['${l.component}']=this.value;previewProductionFIFO()" style="font-size:9px;max-width:200px">${opts}</select>`;
      } else {
        const inv = invCache.items.find(i => i.name === l.component);
        supplierHtml = inv ? `${inv.name}${inv.supplier ? ' — ' + inv.supplier : ''}` : l.component;
      }

      const inv = invCache.items.find(i => i.name === l.component);
      const currentQty = inv ? inv.quantity : null;
      const afterQty = currentQty !== null ? currentQty - willConsume : null;
      const isShort = afterQty !== null && afterQty < 0;

      return `<tr${isShort ? ' style="color:#ef4444"' : ''}>
        <td>${supplierHtml}</td>
        <td>${willConsume.toFixed(3)} ${l.unit}</td>
        <td>${currentQty !== null ? currentQty.toFixed(2) : '—'}</td>
        <td>${afterQty !== null ? afterQty.toFixed(2) : '—'}</td>
      </tr>`;
    }).join('');

    preview.innerHTML = `
      <table class="inv-preview-table">
        <thead><tr><th>Component / Supplier</th><th>Will consume</th><th>Current</th><th>After</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div id="plFifoPreview" style="margin-top:8px"></div>
    `;
    previewProductionFIFO();
  } catch (e) {
    preview.innerHTML = `<em>Preview error: ${e.message}</em>`;
  }
}

async function previewProductionFIFO() {
  const product = document.getElementById('plProduct').value;
  const qty = parseFloat(document.getElementById('plQty').value);
  const fifoWrap = document.getElementById('plFifoPreview');
  if (!fifoWrap || !product || !qty) return;
  try {
    const result = await api.previewProduction({
      product,
      qty_produced: qty,
      selections: Object.keys(productionSelections).length > 0 ? productionSelections : undefined,
    });
    if (!result || !result.lines || result.lines.length === 0) {
      fifoWrap.innerHTML = '';
      return;
    }
    // Each line has: component, needed, unit, shortfall, lot_allocations[]
    // Each allocation has: lot_number, supplier, available, will_consume
    const rows = [];
    for (const line of result.lines) {
      if (line.lot_allocations && line.lot_allocations.length > 0) {
        for (const alloc of line.lot_allocations) {
          const afterQty = alloc.available - alloc.will_consume;
          rows.push(`<tr>
            <td>${line.component}</td>
            <td>${alloc.lot_number || 'unspecified'}${alloc.supplier ? ' — ' + alloc.supplier : ''}</td>
            <td>${alloc.will_consume.toFixed(3)} ${line.unit}</td>
            <td>${afterQty.toFixed(2)}</td>
            <td></td>
          </tr>`);
        }
      }
      if (line.shortfall > 0) {
        rows.push(`<tr style="color:#ef4444">
          <td>${line.component}</td>
          <td colspan="2">SHORTAGE</td>
          <td></td>
          <td style="font-weight:bold">${line.shortfall.toFixed(2)} ${line.unit} short</td>
        </tr>`);
      }
    }
    fifoWrap.innerHTML = `
      <h4 style="font-size:10px;margin-bottom:4px;color:var(--fg2)">FIFO Lot Allocation Preview</h4>
      <table class="inv-preview-table" style="font-size:9px">
        <thead><tr><th>Component</th><th>Lot / Supplier</th><th>Take</th><th>Lot After</th><th></th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  } catch (e) {
    fifoWrap.innerHTML = `<p style="font-size:9px;color:var(--fg2)">FIFO preview not available: ${e.message}</p>`;
  }
}

async function submitProduction() {
  const product = document.getElementById('plProduct').value;
  const qty = parseFloat(document.getElementById('plQty').value);
  if (!product) { setInvStatus('Select a product', true); return; }
  if (!qty || qty <= 0) { setInvStatus('Quantity must be > 0', true); return; }

  const data = {
    product,
    qty_produced: qty,
    batch_id: document.getElementById('plBatch').value.trim() || null,
    performed_by: document.getElementById('plBy').value.trim() || null,
    production_date: document.getElementById('plDate').value || null,
    notes: document.getElementById('plNotes').value.trim() || null,
    selections: Object.keys(productionSelections).length > 0 ? productionSelections : undefined,
  };
  try {
    const txns = await api.logProduction(data);
    setInvStatus(`Production logged: ${qty} x ${product} → ${txns.length} inventory deductions`);
    await refreshInventoryCache();
    renderProductionForm();
  } catch (e) {
    setInvStatus('Failed: ' + e.message, true);
  }
}

// ========== HELPERS ==========
function setInvStatus(msg, isError = false) {
  const el = document.getElementById('invStatus');
  el.textContent = msg;
  el.style.color = isError ? '#ef4444' : '#10b981';
}
