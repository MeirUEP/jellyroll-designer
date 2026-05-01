// ========== API CLIENT ==========
function getApiUrl() { return localStorage.getItem('jr_api_url') || ''; }
function getApiKey() { return localStorage.getItem('jr_api_key') || ''; }

const api = {
  async req(method, path, body) {
    const base = getApiUrl();
    if (!base) throw new Error('API URL not configured');
    const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getApiKey()}` } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${base}${path}`, opts);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    if (res.status === 204) return null;
    return res.json();
  },
  // Chemicals
  listChemicals() { return this.req('GET', '/api/v1/chemicals'); },
  createChemical(data) { return this.req('POST', '/api/v1/chemicals', data); },
  updateChemical(id, data) { return this.req('PUT', `/api/v1/chemicals/${id}`, data); },
  deleteChemical(id) { return this.req('DELETE', `/api/v1/chemicals/${id}`); },
  // Materials
  listMaterials() { return this.req('GET', '/api/v1/materials'); },
  createMaterial(data) { return this.req('POST', '/api/v1/materials', data); },
  updateMaterial(id, data) { return this.req('PUT', `/api/v1/materials/${id}`, data); },
  deleteMaterial(id) { return this.req('DELETE', `/api/v1/materials/${id}`); },
  // Mixes
  listMixes(type) { return this.req('GET', type ? `/api/v1/mixes?type=${type}` : '/api/v1/mixes'); },
  getMix(id) { return this.req('GET', `/api/v1/mixes/${id}`); },
  createMix(data) { return this.req('POST', '/api/v1/mixes', data); },
  updateMix(id, data) { return this.req('PUT', `/api/v1/mixes/${id}`, data); },
  deleteMix(id) { return this.req('DELETE', `/api/v1/mixes/${id}`); },
  // Layer Stacks
  listLayerStacks() { return this.req('GET', '/api/v1/layer-stacks'); },
  getLayerStack(id) { return this.req('GET', `/api/v1/layer-stacks/${id}`); },
  createLayerStack(data) { return this.req('POST', '/api/v1/layer-stacks', data); },
  updateLayerStack(id, data) { return this.req('PUT', `/api/v1/layer-stacks/${id}`, data); },
  deleteLayerStack(id) { return this.req('DELETE', `/api/v1/layer-stacks/${id}`); },
  // Designs
  listDesigns(skip=0, limit=50) { return this.req('GET', `/api/v1/designs?skip=${skip}&limit=${limit}`); },
  getDesign(id) { return this.req('GET', `/api/v1/designs/${id}`); },
  createDesign(data) { return this.req('POST', '/api/v1/designs', data); },
  updateDesign(id, data) { return this.req('PUT', `/api/v1/designs/${id}`, data); },
  deleteDesign(id) { return this.req('DELETE', `/api/v1/designs/${id}`); },
  saveSimResult(id, data) { return this.req('POST', `/api/v1/designs/${id}/simulation`, data); },
  saveCapResult(id, data) { return this.req('POST', `/api/v1/designs/${id}/capacity`, data); },
  // Cell parameter presets
  listCellParamPresets() { return this.req('GET', '/api/v1/cell-param-presets'); },
  getCellParamPreset(id) { return this.req('GET', `/api/v1/cell-param-presets/${id}`); },
  createCellParamPreset(data) { return this.req('POST', '/api/v1/cell-param-presets', data); },
  updateCellParamPreset(id, data) { return this.req('PUT', `/api/v1/cell-param-presets/${id}`, data); },
  deleteCellParamPreset(id) { return this.req('DELETE', `/api/v1/cell-param-presets/${id}`); },
  // Inventory items
  listInventory(category) { return this.req('GET', category ? `/api/v1/inventory?category=${encodeURIComponent(category)}` : '/api/v1/inventory'); },
  createInventoryItem(data) { return this.req('POST', '/api/v1/inventory', data); },
  updateInventoryItem(id, data) { return this.req('PUT', `/api/v1/inventory/${id}`, data); },
  deleteInventoryItem(id) { return this.req('DELETE', `/api/v1/inventory/${id}`); },
  receiveShipment(data) { return this.req('POST', '/api/v1/inventory/receive', data); },
  physicalCount(data) { return this.req('POST', '/api/v1/inventory/physical-count', data); },
  inventorySummary() { return this.req('GET', '/api/v1/inventory/summary'); },
  lowStock() { return this.req('GET', '/api/v1/inventory/low-stock'); },
  // Lots (Phase 1 — lot-level inventory tracking)
  listLotsForItem(itemId) { return this.req('GET', `/api/v1/inventory/${itemId}/lots`); },
  getLot(lotId) { return this.req('GET', `/api/v1/inventory/lots/${lotId}`); },
  updateLot(lotId, data) { return this.req('PUT', `/api/v1/inventory/lots/${lotId}`, data); },
  deleteLot(lotId) { return this.req('DELETE', `/api/v1/inventory/lots/${lotId}`); },
  // Production preview + multi-supplier pickers
  previewProduction(data) { return this.req('POST', '/api/v1/production/preview', data); },
  componentOptions(product) { return this.req('GET', `/api/v1/production/component-options?product=${encodeURIComponent(product)}`); },
  // Recipes
  listRecipes(product) { return this.req('GET', product ? `/api/v1/recipes?product=${encodeURIComponent(product)}` : '/api/v1/recipes'); },
  listRecipeProducts() { return this.req('GET', '/api/v1/recipes/products'); },
  saveRecipeBulk(data) { return this.req('POST', '/api/v1/recipes/bulk', data); },
  deleteRecipeLine(id) { return this.req('DELETE', `/api/v1/recipes/${id}`); },
  deleteProductRecipe(product) { return this.req('DELETE', `/api/v1/recipes/product/${encodeURIComponent(product)}`); },
  // Production log
  logProduction(data) { return this.req('POST', '/api/v1/production/log', data); },
};

// ========== CLOUD COMPONENT CACHE ==========
// Lookup maps populated on load when API is configured
let cloudChemicals = [];   // [{id, name, density, capacity, ...}]  (LEGACY — read-only)
let cloudMaterials = [];   // [{id, name, type, thickness, width, color, ...}]  (LEGACY — read-only)
let cloudMixes = [];       // [{id, name, type, components, ...}]
let cloudLayerStacks = []; // [{id, name, items, ...}]
let cloudInventory = [];   // [{id, name, category, unit, quantity, density, capacity, thickness_mm, width_mm, color, is_active_mat, cost_per_unit, ...}]

function chemByName(name) { return cloudChemicals.find(c => c.name === name); }
function chemById(id) { return cloudChemicals.find(c => c.id === id); }
function matByName(name) { return cloudMaterials.find(m => m.name === name); }
function matById(id) { return cloudMaterials.find(m => m.id === id); }

// Inventory-driven lookups (the new source of truth)
function invById(id) { return cloudInventory.find(i => i.id === id); }
function invByName(name) {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  return cloudInventory.find(i => (i.name || '').trim().toLowerCase() === needle) || null;
}
function invByCategory(category) { return cloudInventory.filter(i => i.category === category); }
async function refreshInventory() {
  if (!isApiConfigured()) return;
  try {
    cloudInventory = (await api.listInventory()) || [];
    // Mirror into the inventory-ui cache so the modal stays consistent
    if (typeof invCache !== 'undefined') invCache.items = cloudInventory;
    // Notify any listeners (formulation tab, layer editor, etc.)
    if (typeof refreshFormulationFromInventory === 'function') refreshFormulationFromInventory();
  } catch (e) { console.warn('Inventory load failed:', e); }
}

function isApiConfigured() { return !!getApiUrl() && !!getApiKey(); }

async function loadCloudCache() {
  if (!isApiConfigured()) return;
  try {
    [cloudChemicals, cloudMaterials, cloudMixes, cloudLayerStacks, cloudInventory] = await Promise.all([
      api.listChemicals(),
      api.listMaterials(),
      api.listMixes(),
      api.listLayerStacks(),
      api.listInventory(),
    ]);
    // Mirror into inventory-ui's cache if it's loaded
    if (typeof invCache !== 'undefined') invCache.items = cloudInventory;
    // Populate preset dropdowns from cloud data
    refreshCloudPresets();
    // Repopulate library dropdowns with cloud chemicals/materials (legacy)
    refreshCompLibDropdowns();
    refreshLayerLibDropdown();
    // Populate the new inventory-driven dropdowns in the formulation tab
    if (typeof refreshFormulationFromInventory === 'function') refreshFormulationFromInventory();
    // Populate BOM overhead dropdowns in Cell Params tab
    if (typeof buildOverheadRows === 'function') buildOverheadRows();
  } catch(e) { console.warn('Cloud cache load failed:', e); }
}

async function refreshCloudPresets() {
  // Merge cloud mixes into cathode/anode preset dropdowns
  cloudMixes.forEach(m => {
    const type = m.type; // 'cathode' or 'anode'
    if (!presetStores[type]['☁ ' + m.name]) {
      presetStores[type]['☁ ' + m.name] = { _cloudId: m.id, _cloud: true };
    }
  });
  // Merge cloud layer stacks
  cloudLayerStacks.forEach(s => {
    if (!presetStores.layers['☁ ' + s.name]) {
      presetStores.layers['☁ ' + s.name] = { _cloudId: s.id, _cloud: true };
    }
  });
  // Merge cloud cell-parameter presets into design dropdown
  try {
    const items = await api.listCellParamPresets();
    (items || []).forEach(p => {
      presetStores.design['☁ ' + p.name] = { _cloudId: p.id, _cloud: true, params: p.params };
    });
  } catch(e) { /* ignore if endpoint missing (backend not yet restarted) */ }
  // Refresh all dropdowns
  ['cathode', 'anode', 'layers', 'design'].forEach(loadPresetList);
}

// Convert frontend mix components → API format.
// Prefer inventory_item_id (the new source of truth); fall back to
// chemical_id via name lookup for legacy rows that haven't been remapped.
// capacity_override carries the user's per-design capacity choice (mAh/g).
function mixToApi(presetData, type) {
  const components = (presetData.components || []).map(c => {
    const inv = c.inventory_item_id ? invById(c.inventory_item_id) : null;
    const chem = !inv ? chemByName(c.name) : null;
    return {
      inventory_item_id: inv ? inv.id : null,
      chemical_id: chem ? chem.id : null,
      name_snapshot: c.name || (inv ? inv.name : null),
      wt_pct: c.wt,
      is_active: !!c.isActive,
      capacity_override: (c.cap != null) ? c.cap : null,
    };
  }).filter(c => c.inventory_item_id || c.chemical_id); // skip fully-unknown rows
  return {
    name: '', // caller sets this
    type: type,
    bulk_density: presetData.bulk_density || 0,
    thickness: presetData.thickness || null,
    mesh_density: presetData.mesh_dens || 0,
    cc_material: presetData.cc_material || null,
    components,
  };
}

// Convert API mix → frontend preset format.
// Resolve each component through inventory first, then fall back to the
// legacy chemicals cache so existing designs still load. Capacity prefers
// the stored override (the user's design choice) over the inventory default.
function mixFromApi(mix) {
  const components = (mix.components || []).map(c => {
    const inv = c.inventory_item_id ? invById(c.inventory_item_id) : null;
    const chem = !inv && c.chemical_id ? chemById(c.chemical_id) : null;
    const src = inv || chem || null;
    const invDefaultCap = inv ? (inv.capacity || 0) : (chem ? (chem.capacity || 0) : 0);
    const cap = (c.capacity_override != null) ? c.capacity_override : invDefaultCap;
    return {
      inventory_item_id: inv ? inv.id : null,
      name: src ? src.name : (c.name_snapshot || 'Unknown'),
      wt: c.wt_pct,
      density: src ? (src.density || 0) : 0,
      cap,
      isActive: !!c.is_active,
    };
  });
  return {
    components,
    bulk_density: mix.bulk_density,
    thickness: mix.thickness || null,
    mesh_dens: mix.mesh_density,
    cc_material: mix.cc_material,
  };
}

// Convert frontend layers → API layer stack format.
// The layer-stack items column is JSONB, so we stash inventory_item_id
// (for passive layers) and mix_id (for electrodes) alongside the legacy
// material_id. That lets layerStackFromApi re-link loaded layers to
// inventory/mix — keeping them out of "orphan" mode — without requiring
// a DB migration.
async function layerStackToApi(layersArr) {
  const items = [];
  for (let i = 0; i < layersArr.length; i++) {
    const l = layersArr[i];
    if (l.type === 'mandrel') continue;

    // Still create/lookup a legacy material for material_id so old
    // code paths keep working. The inventory/mix IDs are the new
    // authoritative links.
    let mat = matByName(l.name);
    if (!mat && isApiConfigured()) {
      try {
        const matType = ['cathode','anode'].includes(l.type) ? 'other' : (l.type || 'other');
        mat = await api.createMaterial({ name: l.name, type: matType, thickness: l.t, width: l.w, color: l.color || '#888' });
        cloudMaterials.push(mat);
      } catch(e) { console.warn('Could not create material:', l.name, e); continue; }
    }
    if (!mat) continue;

    items.push({
      material_id: mat.id,
      inventory_item_id: l.inventory_item_id || null,
      mix_id: l.mix_id || null,
      position: i,
      role: l.type || 'other',
    });
  }
  return { name: '', items };
}

// Convert API layer stack → frontend layers format.
// Prefer inventory/mix links when present (new-format stacks) so the
// layers come back fully linked. Fall back to the legacy material_id
// lookup for old saved stacks.
function layerStackFromApi(stack) {
  return (stack.items || [])
    .sort((a, b) => a.position - b.position)
    .map(item => {
      const inv = item.inventory_item_id ? invById(item.inventory_item_id) : null;
      const mix = item.mix_id ? cloudMixes.find(m => m.id === item.mix_id) : null;
      const mat = !inv && !mix ? matById(item.material_id) : null;
      const src = inv || mix || mat;
      return {
        name: src ? src.name : 'Unknown',
        type: item.role || (mat ? mat.type : 'other'),
        t: mix ? (mix.thickness || 1.0)
           : inv ? (inv.thickness_mm || 0.1)
           : mat ? mat.thickness
           : 0.1,
        w: inv ? (inv.width_mm || 200)
           : mat ? mat.width
           : 200,
        color: inv ? (inv.color || '#888')
             : mix ? (mix.type === 'cathode' ? '#3b82f6' : '#16a34a')
             : mat ? (mat.color || '#888')
             : '#888',
        inventory_item_id: inv ? inv.id : null,
        mix_id: mix ? mix.id : null,
      };
    });
}
let currentDesignId = null;
let currentDesignName = '';
let currentDesignIsExperimental = false;  // tracks the flag of the loaded design
                                           // so Save buttons can decide whether to
                                           // update-in-place or force a new record

function showToast(msg, isError=false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

function saveApiSettings() {
  localStorage.setItem('jr_api_url', document.getElementById('settApiUrl').value.replace(/\/+$/, ''));
  localStorage.setItem('jr_api_key', document.getElementById('settApiKey').value);
  document.getElementById('modalSettings').classList.add('hidden');
  showToast('API settings saved');
}

