// ========== CAPACITY CALCULATION (from JellyRollModel_CORRECTED.xlsx) ==========
function computeCapacity() {
  if (!simResult) { capResult = null; return; }
  const s = simResult;
  const ep = elecProps;
  const cathode = layers.find(l => l.type === 'cathode');
  const anode = layers.find(l => l.type === 'anode');
  if (!cathode || !anode) { capResult = null; return; }

  // Electrode lengths from simulation (computed, not input)
  const cathLenMm = cathode.computedLen || cathode.len;
  const anodLenMm = anode.computedLen || anode.len;
  const cathLenIn = cathLenMm / 25.4;
  const anodLenIn = anodLenMm / 25.4;

  // Widths (mm -> inches for volume/mesh calc)
  const cathWidthMm = cathode.w;
  const anodWidthMm = anode.w;
  const cathWidthIn = cathWidthMm / 25.4;
  const anodWidthIn = anodWidthMm / 25.4;

  // Thicknesses (mm -> inches)
  const cathThickMm = cathode.t;
  const anodThickMm = anode.t;
  const cathThickIn = cathThickMm / 25.4;
  const anodThickIn = anodThickMm / 25.4;

  // Volumes (in³) = length × width × thickness
  const cathVolIn3 = cathLenIn * cathWidthIn * cathThickIn;
  const anodVolIn3 = anodLenIn * anodWidthIn * anodThickIn;

  // Total mass (g) = volume (cm³) × bulk density
  // 1 in³ = 16.387064 cm³
  const in3ToCm3 = 16.387064;
  const cathVolCm3 = cathVolIn3 * in3ToCm3;
  const anodVolCm3 = anodVolIn3 * in3ToCm3;
  const cathTotalMass = cathVolCm3 * ep.cath_bulk_density;
  const anodTotalMass = anodVolCm3 * ep.anod_bulk_density;

  // Mesh mass (g) = mesh_density (g/in²) × length (in) × width (in)
  const cathMeshMass = ep.cath_mesh_dens * cathLenIn * cathWidthIn;
  const anodMeshMass = ep.anod_mesh_dens * anodLenIn * anodWidthIn;

  // Paste mass = total - mesh
  const cathPasteMass = cathTotalMass - cathMeshMass;
  const anodPasteMass = anodTotalMass - anodMeshMass;

  // Cathode capacity (Ah) = paste_mass × active_wt% × specific_capacity / 1000
  const cathCapAh = cathPasteMass * ep.cath_active_wt * ep.cath_spec_cap / 1000;

  // Anode capacity (Ah) = paste_mass × (Zn_wt% × Zn_cap + ZnO_wt% × ZnO_cap) / 1000
  const anodCapAh = anodPasteMass * (ep.anod_zn_wt * ep.anod_zn_cap + ep.anod_zno_wt * ep.anod_zno_cap) / 1000;

  // Cell capacity (cathode-limited, 1e⁻)
  const cellCapAh = Math.min(cathCapAh, anodCapAh);
  const npRatio = cathCapAh / anodCapAh;

  // Cell energy at 1.2V (1e⁻)
  const cellEnergy1e = cellCapAh * 1.2;

  // Total dry mass
  const totalDryMass = cathTotalMass + anodTotalMass;

  // Utilization table
  const utilTable = [10, 20, 30, 40, 50, 60, 80, 100, 120, 140, 160, 180, 200, 220].map(cycledAh => ({
    cycledAh,
    cathUtil: (cycledAh / cathCapAh * 100),
    anodUtil: (cycledAh / anodCapAh * 100),
    energy: cycledAh * 1.2,
    anodExcess: ((anodCapAh - cycledAh) / cycledAh * 100),
    dod: (cycledAh / cathCapAh * 100),
  }));

  capResult = {
    cathTotalMass, anodTotalMass, cathMeshMass, anodMeshMass,
    cathPasteMass, anodPasteMass,
    cathCapAh, anodCapAh, cellCapAh, npRatio,
    cellEnergy1e, totalDryMass,
    cathVolCm3, anodVolCm3,
    utilTable,
    // Store source layer values for transparency
    cathThickMm, anodThickMm, cathWidthMm, anodWidthMm, cathLenMm, anodLenMm,
  };
}

// ========== UI UPDATES ==========
