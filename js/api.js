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
};

// ========== CLOUD COMPONENT CACHE ==========
// Lookup maps populated on load when API is configured
let cloudChemicals = [];   // [{id, name, density, capacity, ...}]
let cloudMaterials = [];   // [{id, name, type, thickness, width, color, ...}]
let cloudMixes = [];       // [{id, name, type, components, ...}]
let cloudLayerStacks = []; // [{id, name, items, ...}]

function chemByName(name) { return cloudChemicals.find(c => c.name === name); }
function chemById(id) { return cloudChemicals.find(c => c.id === id); }
function matByName(name) { return cloudMaterials.find(m => m.name === name); }
function matById(id) { return cloudMaterials.find(m => m.id === id); }

function isApiConfigured() { return !!getApiUrl() && !!getApiKey(); }

async function loadCloudCache() {
  if (!isApiConfigured()) return;
  try {
    [cloudChemicals, cloudMaterials, cloudMixes, cloudLayerStacks] = await Promise.all([
      api.listChemicals(),
      api.listMaterials(),
      api.listMixes(),
      api.listLayerStacks(),
    ]);
    // Populate preset dropdowns from cloud data
    refreshCloudPresets();
    // Repopulate library dropdowns with cloud chemicals/materials
    refreshCompLibDropdowns();
    refreshLayerLibDropdown();
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

// Convert frontend mix components → API format
function mixToApi(presetData, type) {
  const components = (presetData.components || []).map(c => {
    let chem = chemByName(c.name);
    return {
      chemical_id: chem ? chem.id : null,
      wt_pct: c.wt,
      is_active: !!c.isActive,
    };
  }).filter(c => c.chemical_id); // skip unknown chemicals
  return {
    name: '', // caller sets this
    type: type,
    bulk_density: presetData.bulk_density || 0,
    mesh_density: presetData.mesh_dens || 0,
    cc_material: presetData.cc_material || null,
    components,
  };
}

// Convert API mix → frontend preset format
function mixFromApi(mix) {
  const components = (mix.components || []).map(c => {
    const chem = chemById(c.chemical_id);
    return {
      name: chem ? chem.name : 'Unknown',
      wt: c.wt_pct,
      density: chem ? chem.density : 0,
      cap: chem ? chem.capacity : 0,
      isActive: !!c.is_active,
    };
  });
  return {
    components,
    bulk_density: mix.bulk_density,
    mesh_dens: mix.mesh_density,
    cc_material: mix.cc_material,
  };
}

// Convert frontend layers → API layer stack format
async function layerStackToApi(layersArr) {
  const items = [];
  for (let i = 0; i < layersArr.length; i++) {
    const l = layersArr[i];
    if (l.type === 'mandrel') continue;
    let mat = matByName(l.name);
    // Auto-create material if not in cloud
    if (!mat && isApiConfigured()) {
      try {
        const matType = ['cathode','anode'].includes(l.type) ? 'other' : (l.type || 'other');
        mat = await api.createMaterial({ name: l.name, type: matType, thickness: l.t, width: l.w, color: l.color || '#888' });
        cloudMaterials.push(mat);
      } catch(e) { console.warn('Could not create material:', l.name, e); continue; }
    }
    if (mat) {
      items.push({ material_id: mat.id, position: i, role: l.type || 'other' });
    }
  }
  return { name: '', items };
}

// Convert API layer stack → frontend layers format
function layerStackFromApi(stack) {
  return (stack.items || [])
    .sort((a, b) => a.position - b.position)
    .map(item => {
      const mat = matById(item.material_id);
      return {
        name: mat ? mat.name : 'Unknown',
        type: item.role || (mat ? mat.type : 'other'),
        t: mat ? mat.thickness : 0.1,
        w: mat ? mat.width : 200,
        color: mat ? (mat.color || '#888') : '#888',
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

