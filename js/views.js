// ========== VIEW SWITCHING ==========
document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', e => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.getElementById('panel3d').style.display = currentView === '3d' ? '' : 'none';
    document.getElementById('mainCanvas').style.display = currentView === '3d' ? 'none' : '';
    document.getElementById('threeContainer').style.display = currentView === '3d' ? '' : 'none';
    // Hide legend when not in top view
    const leg = document.getElementById('topLegend');
    if (leg) leg.style.display = currentView === 'top' ? '' : 'none';
    renderView();
  });
});

function renderView() {
  if (!simResult) return;
  if (currentView === 'side') renderSide();
  else if (currentView === 'top') renderTop();
  else if (currentView === 'unroll') renderUnroll();
  else if (currentView === 'tabmap') renderTabMap();
  else if (currentView === '3d') render3D();
}

function var_fg() {
  return getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#f3f4f6';
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ========== SIDE VIEW (improved) ==========
function renderSide() {
  const canvas = document.getElementById('mainCanvas');
  const wrap = document.getElementById('canvasWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (!simResult) return;

  const s = simResult;
  const outerR = s.outerR;
  const cellH = params.cell_h;
  const mandrelR = params.mandrel_d / 2;
  const fg = var_fg();

  // Layout: center cell with space for tabs above and dimensions below
  const TAB_AREA = 50, DIM_AREA = 55, PAD_SIDE = 50;
  const availW = W - PAD_SIDE * 2;
  const availH = H - TAB_AREA - DIM_AREA;
  const sc = Math.min(availW / (outerR * 2 + 40), availH / cellH);

  const cx = W / 2;
  const cellTop = TAB_AREA;
  const cellBot = cellTop + cellH * sc;
  const cellLeft = cx - outerR * sc;
  const cellRight = cx + outerR * sc;

  // Cell rectangle outline
  ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
  ctx.strokeRect(cellLeft, cellTop, outerR * 2 * sc, cellH * sc);

  // Draw layer-colored rings for each turn with width differentiation
  // Uses proportional radial allocation based on layer thickness
  s.turns.forEach((turn, ti) => {
    const prevR = ti > 0 ? s.turns[ti-1].r : mandrelR;
    const innerR_t = prevR;
    const bandW = turn.r - innerR_t;
    const totalThick = turn.active.reduce((sum, l) => sum + l.t, 0);

    let cumThick = 0;
    turn.active.forEach((layer, li) => {
      const rInner = totalThick > 0 ? innerR_t + bandW * cumThick / totalThick : innerR_t;
      const rOuter = totalThick > 0 ? innerR_t + bandW * (cumThick + layer.t) / totalThick : turn.r;
      cumThick += layer.t;
      const lw = (rOuter - rInner) * sc;

      // Layer height based on its width vs cell height — more visible differentiation
      const layerH = layer.w * sc;
      const yOff = (cellH * sc - layerH) / 2;
      const isElectrode = layer.type === 'cathode' || layer.type === 'anode';

      ctx.fillStyle = hexToRgba(layer.color, isElectrode ? 0.7 : 0.4);
      // Left side
      ctx.fillRect(cx - rOuter * sc, cellTop + yOff, lw, layerH);
      // Right side
      ctx.fillRect(cx + rInner * sc, cellTop + yOff, lw, layerH);

      // Draw overhang shading where electrode is shorter than cell height
      if (isElectrode && yOff > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(cx - rOuter * sc, cellTop, lw, yOff);
        ctx.fillRect(cx - rOuter * sc, cellBot - yOff, lw, yOff);
        ctx.fillRect(cx + rInner * sc, cellTop, lw, yOff);
        ctx.fillRect(cx + rInner * sc, cellBot - yOff, lw, yOff);
      }
    });

    // Faint turn boundary lines
    ctx.strokeStyle = 'rgba(150,150,150,0.12)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx - turn.r * sc, cellTop); ctx.lineTo(cx - turn.r * sc, cellBot); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + turn.r * sc, cellTop); ctx.lineTo(cx + turn.r * sc, cellBot); ctx.stroke();
  });

  // Mandrel shading
  ctx.fillStyle = hexToRgba('#888899', 0.4);
  ctx.fillRect(cx - mandrelR * sc, cellTop, mandrelR * 2 * sc, cellH * sc);

  // Tabs — spread labels across full halves
  const tabLineH = 18;
  function drawSideTabs(tabs, color, prefix, side) {
    const count = tabs.length;
    if (count === 0) return;
    const minSp = 18, pad = 20;
    const needed = count * minSp;
    let aS, aE;
    if (side === 'left') { aE = cx - 10; aS = Math.max(pad, aE - needed); }
    else { aS = cx + 10; aE = Math.min(W - pad, aS + needed); }
    const sp = count > 1 ? (aE - aS) / (count - 1) : 0;

    tabs.forEach((tab, i) => {
      const x = side === 'left' ? cx - tab.r * sc : cx + tab.r * sc;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, cellTop); ctx.lineTo(x, cellTop - tabLineH); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, cellTop, 2, 0, Math.PI * 2); ctx.fill();
      const lx = count > 1 ? aS + i * sp : (aS + aE) / 2;
      ctx.strokeStyle = color; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x, cellTop - tabLineH); ctx.lineTo(lx, 18); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${prefix}${tab.idx}`, lx, 12);
    });
  }
  drawSideTabs(s.cTabs, '#3b82f6', 'C', 'left');
  drawSideTabs(s.aTabs, '#16a34a', 'A', 'right');

  // Dimension annotations
  ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 0.8;
  ctx.font = '10px sans-serif';

  // Cell height — right bracket
  const dimX = cellRight + 15;
  ctx.beginPath();
  ctx.moveTo(dimX - 4, cellTop); ctx.lineTo(dimX, cellTop); ctx.lineTo(dimX, cellBot); ctx.lineTo(dimX - 4, cellBot);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillText(`${cellH}mm`, dimX + 4, (cellTop + cellBot) / 2 + 4);

  // OD — bottom bracket
  const dimY = cellBot + 15;
  ctx.beginPath();
  ctx.moveTo(cellLeft, dimY - 4); ctx.lineTo(cellLeft, dimY); ctx.lineTo(cellRight, dimY); ctx.lineTo(cellRight, dimY - 4);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillText(`OD ${(outerR*2).toFixed(1)}mm`, cx, dimY + 12);

  // Mandrel diameter — below OD
  const mL = cx - mandrelR * sc, mR = cx + mandrelR * sc;
  const dimY2 = dimY + 22;
  ctx.strokeStyle = '#888899';
  ctx.beginPath();
  ctx.moveTo(mL, dimY2 - 4); ctx.lineTo(mL, dimY2); ctx.lineTo(mR, dimY2); ctx.lineTo(mR, dimY2 - 4);
  ctx.stroke();
  ctx.fillStyle = '#888899';
  ctx.fillText(`\u00D8${params.mandrel_d}mm`, cx, dimY2 + 12);

  // Legend as overlay in bottom-left corner
  ctx.textAlign = 'left'; ctx.font = '9px sans-serif';
  const uniqueLayers = [];
  const seen = new Set();
  layers.filter(l => l.type !== 'mandrel').forEach(l => {
    const key = l.name.startsWith('Cellophane') ? 'Cellophane' : l.name;
    if (!seen.has(key)) { seen.add(key); uniqueLayers.push({name: key, color: l.color}); }
  });
  const legW = 90, legH = uniqueLayers.length * 14 + 8;
  const legX = 8, legY0 = H - legH - 8;
  // Legend background
  ctx.fillStyle = 'rgba(17,24,39,0.85)';
  ctx.fillRect(legX, legY0, legW, legH);
  ctx.strokeStyle = 'rgba(75,85,99,0.5)'; ctx.lineWidth = 0.5;
  ctx.strokeRect(legX, legY0, legW, legH);
  uniqueLayers.forEach((l, i) => {
    const y = legY0 + 6 + i * 14;
    ctx.fillStyle = l.color;
    ctx.fillRect(legX + 4, y, 8, 8);
    ctx.fillStyle = fg;
    ctx.fillText(l.name, legX + 16, y + 7);
  });
}

// ========== TOP VIEW (improved) ==========
function renderTop() {
  const canvas = document.getElementById('mainCanvas');
  const wrap = document.getElementById('canvasWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (!simResult) return;

  const s = simResult;
  const outerR = s.outerR;
  const mandrelR = params.mandrel_d / 2;
  const fg = var_fg();

  const tabLen = 35;
  const PAD_SIDES = 80, PAD_TOP = 30, PAD_BOT = 30;
  const sc = Math.min((W - PAD_SIDES*2) / (outerR*2), (H - PAD_TOP - PAD_BOT) / (outerR*2));
  const cx = W / 2;
  const cy = PAD_TOP + outerR * sc;

  // Outer boundary circle
  ctx.beginPath(); ctx.arc(cx, cy, outerR * sc, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(150,150,150,0.4)'; ctx.lineWidth = 1; ctx.stroke();

  // Layer arcs per turn — with distinct colors and thickness for electrodes
  s.turns.forEach((turn, ti) => {
    const prevR = ti > 0 ? s.turns[ti-1].r : mandrelR;
    const innerR = prevR;
    const bandW = turn.r - innerR;
    const nActive = turn.active.length;
    if (nActive === 0) return;

    const totalThick = turn.active.reduce((sum, l) => sum + l.t, 0);
    let cumThick = 0;
    turn.active.forEach((layer, li) => {
      const vis = layerVisibility[layer.name] !== false;
      if (!vis) { cumThick += layer.t; return; }
      const layerFrac = totalThick > 0 ? layer.t / totalThick : 1 / nActive;
      const cumFrac = totalThick > 0 ? cumThick / totalThick : li / nActive;
      const rMid = innerR + bandW * (cumFrac + layerFrac / 2);
      const baseThick = bandW * layerFrac * 0.85;
      cumThick += layer.t;
      // Electrodes get thicker strokes
      const isElectrode = layer.type === 'cathode' || layer.type === 'anode';
      const lw = isElectrode ? Math.max(2.5, baseThick * sc * 1.2) : Math.max(1, baseThick * sc);

      // Compute partial arc angles
      const layerArcStart = Math.max(turn.arcStart, layer.off);
      const layerArcEnd = Math.min(turn.arc, layer.off + layerLen(layer));
      const turnArcLen = turn.circ;
      const fracStart = (layerArcStart - turn.arcStart) / turnArcLen;
      const fracEnd = (layerArcEnd - turn.arcStart) / turnArcLen;
      const angStart = fracStart * Math.PI * 2;
      const angEnd = fracEnd * Math.PI * 2;

      ctx.beginPath();
      ctx.arc(cx, cy, rMid * sc, angStart, angEnd);
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = lw;
      ctx.globalAlpha = isElectrode ? 1.0 : 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Endpoint markers — only show on partial arcs (not full 360°)
      const isPartial = (fracEnd - fracStart) < 0.98;
      if (isPartial && isElectrode) {
        const rPx = rMid * sc;
        const tickLen = 6;
        // Start tick — perpendicular white line
        const sdx = Math.cos(angStart), sdy = Math.sin(angStart);
        const sx = cx + rPx * sdx, sy = cy + rPx * sdy;
        ctx.beginPath();
        ctx.moveTo(sx - sdy * tickLen, sy + sdx * tickLen);
        ctx.lineTo(sx + sdy * tickLen, sy - sdx * tickLen);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        // "S" label
        ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('S', sx + sdy * 11, sy - sdx * 11);

        // End tick — perpendicular colored line with arrowhead
        const edx = Math.cos(angEnd), edy = Math.sin(angEnd);
        const ex = cx + rPx * edx, ey = cy + rPx * edy;
        ctx.beginPath();
        ctx.moveTo(ex - edy * tickLen, ey + edx * tickLen);
        ctx.lineTo(ex + edy * tickLen, ey - edx * tickLen);
        ctx.strokeStyle = layer.color; ctx.lineWidth = 2.5; ctx.stroke();
        // "E" label
        ctx.fillStyle = layer.color;
        ctx.fillText('E', ex + edy * 11, ey - edx * 11);
      } else if (isPartial) {
        // Non-electrode partial arcs: small dots
        const sx = cx + rMid * sc * Math.cos(angStart);
        const sy = cy + rMid * sc * Math.sin(angStart);
        const ex = cx + rMid * sc * Math.cos(angEnd);
        const ey = cy + rMid * sc * Math.sin(angEnd);
        ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI*2); ctx.fillStyle=layer.color; ctx.fill();
      }
    });
  });

  // Mandrel circle
  ctx.beginPath(); ctx.arc(cx, cy, mandrelR * sc, 0, Math.PI * 2);
  ctx.fillStyle = '#888899'; ctx.fill();
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1; ctx.stroke();

  // Turn number labels on outermost ring
  if (s.turns.length > 0) {
    ctx.font = '8px sans-serif'; ctx.fillStyle = fg; ctx.textAlign = 'center';
    s.turns.forEach((t, i) => {
      // Place in bottom half to avoid tab overlap (tabs now on left/right)
      const ang = Math.PI / 4 + Math.PI / 2 + (i / s.turns.length) * Math.PI; // bottom quadrants
      const lx = cx + (t.r * sc + 10) * Math.cos(ang);
      const ly = cy + (t.r * sc + 10) * Math.sin(ang);
      if (i % 2 === 0 || s.turns.length <= 6) { // skip some if too many
        ctx.fillText(`T${t.turn}`, lx, ly + 3);
      }
    });
  }

  // Tabs viewed from above — match 3D appearance.
  // In 3D, tabs are thin vertical strips at each ring radius, all at the same
  // drill angle, rotated so they sit perpendicular to the radial direction.
  // From the top they look like short tangential dashes at each radius.
  function drawTabsTopView(tabs, color, prefix, cellAngleDeg) {
    const count = tabs.length;
    if (count === 0) return;
    // 0° = 3 o'clock (right). Canvas angle 0 = right, increases CW.
    const canvasAng = -cellAngleDeg * Math.PI / 180;
    const dx = Math.cos(canvasAng);
    const dy = Math.sin(canvasAng);

    // Tab dimensions: match 3D BoxGeometry(tW, tH, 0.5)
    // From top-down, the box appears as tW × 0.5 rectangle.
    // tW = max(tabW*0.3, 2), depth = 0.5mm — scale to canvas pixels.
    const tW = Math.max(params.tab_w * 0.3, 2) * sc;  // tangential width
    const tD = Math.max(1.5, 0.5 * sc);                // radial depth (0.5mm)
    const halfW = Math.max(tW / 2, 3);  // min 3px half-width for visibility
    const halfD = Math.max(tD / 2, 1.5);

    // Perpendicular (tangential) direction
    const px = -dy, py = dx;

    tabs.forEach(tab => {
      const r = tab.r * sc;
      const tcx = cx + r * dx;
      const tcy = cy + r * dy;

      // Rectangle corners: tangential ± halfW, radial ± halfD
      ctx.beginPath();
      ctx.moveTo(tcx + px * halfW + dx * halfD, tcy + py * halfW + dy * halfD);
      ctx.lineTo(tcx + px * halfW - dx * halfD, tcy + py * halfW - dy * halfD);
      ctx.lineTo(tcx - px * halfW - dx * halfD, tcy - py * halfW - dy * halfD);
      ctx.lineTo(tcx - px * halfW + dx * halfD, tcy - py * halfW + dy * halfD);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // Angle label outside the outermost ring
    const lblR = outerR * sc + 12;
    ctx.fillStyle = fg; ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${cellAngleDeg.toFixed(1)}°`, cx + lblR * dx, cy + lblR * dy);
    ctx.fillStyle = color; ctx.font = '8px sans-serif';
    ctx.fillText(`${count}× ${prefix}`, cx + (lblR + 12) * dx, cy + (lblR + 12) * dy);
  }

  drawTabsTopView(s.cTabs, '#3b82f6', 'C', s.drillAngleDeg);
  drawTabsTopView(s.aTabs, '#16a34a', 'A', s.anodAngleDeg);
  ctx.textBaseline = 'alphabetic';

  renderLegend();
}

function renderLegend() {
  let legend = document.getElementById('topLegend');
  if (!legend) {
    legend = document.createElement('div');
    legend.id = 'topLegend';
    legend.className = 'legend';
    document.getElementById('canvasWrap').appendChild(legend);
  }
  legend.style.display = currentView === 'top' ? '' : 'none';
  if (currentView !== 'top') return;

  const groups = {};
  layers.filter(l => l.type !== 'mandrel').forEach(l => {
    const key = l.name.startsWith('Cellophane') ? 'Cellophane' : l.name;
    if (!groups[key]) groups[key] = { color: l.color, layers: [] };
    groups[key].layers.push(l);
  });

  let html = '<div class="legend-btns"><button class="btn-sm" id="legendAll">All</button><button class="btn-sm" id="legendNone">None</button></div>';
  for (const [key, g] of Object.entries(groups)) {
    const anyVisible = g.layers.some(l => layerVisibility[l.name] !== false);
    html += `<div class="legend-item${anyVisible?'':' hidden'}" data-group="${key}"><div class="swatch" style="background:${g.color}"></div><span>${key}</span></div>`;
  }
  legend.innerHTML = html;

  legend.querySelectorAll('.legend-item').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.group;
      const g = groups[key];
      const anyVisible = g.layers.some(l => layerVisibility[l.name] !== false);
      g.layers.forEach(l => layerVisibility[l.name] = !anyVisible);
      renderView();
    });
  });
  document.getElementById('legendAll')?.addEventListener('click', () => {
    layers.forEach(l => layerVisibility[l.name] = true); renderView();
  });
  document.getElementById('legendNone')?.addEventListener('click', () => {
    layers.forEach(l => layerVisibility[l.name] = false); renderView();
  });
}

// ========== UNROLL VIEW (improved) ==========
function renderUnroll() {
  const canvas = document.getElementById('mainCanvas');
  const wrap = document.getElementById('canvasWrap');
  const W = wrap.clientWidth;
  const ctx = canvas.getContext('2d');
  if (!simResult) return;

  const s = simResult;
  const nonMandrel = layers.filter(l => l.type !== 'mandrel');
  const maxLen = Math.max(...nonMandrel.map(l => l.off + layerLen(l)));
  const fg = var_fg();

  const H = wrap.clientHeight;
  const PAD_L = 112, PAD_R = 50;
  const RULER_H = 36;
  const sc = (W - PAD_L - PAD_R) / maxLen;

  // Scale strip sizes to fit available height
  const availH = H - RULER_H - 20;
  const defaultStripH = 22, defaultGap = 6;
  const defaultTotal = nonMandrel.length * (defaultStripH + defaultGap);
  const vScale = defaultTotal > availH ? availH / defaultTotal : 1;
  const stripH = Math.max(12, defaultStripH * vScale);
  const stripGap = Math.max(3, defaultGap * vScale);

  // Compute total height
  let totalH = RULER_H + 10;
  nonMandrel.forEach(() => { totalH += stripH + stripGap; });
  totalH += 20;

  canvas.width = W;
  canvas.height = Math.max(totalH, wrap.clientHeight);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ruler background
  ctx.fillStyle = 'rgba(50,50,60,0.5)';
  ctx.fillRect(0, 0, W, RULER_H);

  // mm scale (bottom of ruler)
  ctx.fillStyle = fg; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  const mmStep = Math.pow(10, Math.floor(Math.log10(maxLen / 10)));
  for (let mm = 0; mm <= maxLen; mm += mmStep) {
    const x = PAD_L + mm * sc;
    if (x > W - PAD_R) break;
    ctx.fillText(`${mm}`, x, RULER_H - 4);
    ctx.beginPath(); ctx.moveTo(x, RULER_H - 14); ctx.lineTo(x, RULER_H - 8);
    ctx.strokeStyle = 'rgba(150,150,150,0.5)'; ctx.lineWidth = 0.5; ctx.stroke();
  }

  // Turn markers (top of ruler) + full vertical grid lines
  ctx.font = '8px sans-serif';
  s.turns.forEach(t => {
    const x = PAD_L + t.arc * sc;
    if (x > W - PAD_R) return;
    ctx.fillStyle = 'rgba(150,150,150,0.7)';
    ctx.fillText(`T${t.turn}`, x, 10);
    // Full-height grid line
    ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, canvas.height);
    ctx.strokeStyle = 'rgba(100,100,100,0.15)'; ctx.lineWidth = 0.5; ctx.stroke();
  });

  // === SECTION 1: Layer Strips (no tabs) ===
  let y = RULER_H + 10;
  nonMandrel.forEach(l => {
    const isElectrode = l.type === 'cathode' || l.type === 'anode';
    const stripY = y;
    const x0 = PAD_L + l.off * sc;
    const effLen = layerLen(l);
    const w = effLen * sc;

    // Faint background
    ctx.fillStyle = 'rgba(100,100,100,0.08)';
    ctx.fillRect(PAD_L, stripY, (W - PAD_L - PAD_R), stripH);

    // Strip
    ctx.fillStyle = hexToRgba(l.color, isElectrode ? 0.8 : 0.6);
    ctx.fillRect(x0, stripY, w, stripH);
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, stripY, w, stripH);

    // Label on left
    ctx.fillStyle = fg;
    ctx.font = isElectrode ? 'bold 11px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(l.name, PAD_L - 6, stripY + stripH / 2 + 4);

    // Length label inside strip
    if (w > 50) {
      ctx.fillStyle = '#fff'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(effLen)}mm`, x0 + w / 2, stripY + stripH / 2 + 3);
    }

    // Start marker
    if (l.off > 0) {
      ctx.beginPath(); ctx.moveTo(x0, stripY); ctx.lineTo(x0 + 5, stripY + stripH/2); ctx.lineTo(x0, stripY + stripH);
      ctx.fillStyle = l.color; ctx.fill();
    }

    // End marker
    ctx.beginPath();
    ctx.moveTo(x0 + w, stripY); ctx.lineTo(x0 + w - 5, stripY + stripH/2); ctx.lineTo(x0 + w, stripY + stripH);
    ctx.fillStyle = l.color; ctx.fill();

    // Thickness label on right side
    ctx.fillStyle = fg; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${l.t}mm`, W - PAD_R + 4, stripY + stripH / 2 + 3);

    y += stripH + stripGap;
  });
}

// ========== TAB MAP VIEW ==========
function renderTabMap() {
  const canvas = document.getElementById('mainCanvas');
  const wrap = document.getElementById('canvasWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const ctx = canvas.getContext('2d');
  if (!simResult) return;

  const s = simResult;
  const fg = var_fg();
  const PAD_L = 90, PAD_R = 30;

  // Layout: generous spacing for clean look
  const rulerH = 18;       // mm ruler row
  const labelH = 20;       // tab label row (C1, C2, ...)
  const tabLineH = 25;     // tab marker lines
  const stripH = 28;       // electrode strip
  const distH = 20;        // distance labels below strip
  const sectionGap = 50;   // generous gap between electrodes
  const sectionH = rulerH + 6 + labelH + tabLineH + stripH + distH;

  const electrodes = [
    { layer: layers.find(l => l.type === 'cathode'), tabs: s.cTabs, color: '#3b82f6', prefix: 'C' },
    { layer: layers.find(l => l.type === 'anode'), tabs: s.aTabs, color: '#16a34a', prefix: 'A' },
  ].filter(e => e.layer);

  const totalH = electrodes.length * sectionH + (electrodes.length - 1) * sectionGap + 30;
  canvas.width = W;
  canvas.height = Math.max(totalH, H);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let y = 10;

  electrodes.forEach((elec, ei) => {
    const { layer, tabs, color, prefix } = elec;
    const effLen = layerLen(layer);
    const eSc = (W - PAD_L - PAD_R) / effLen;

    // --- Row 1: Electrode name + mm ruler ---
    const rulerY = y;
    ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(layer.name, PAD_L - 8, rulerY + 12);

    // Ruler background
    ctx.fillStyle = 'rgba(50,50,60,0.35)';
    ctx.fillRect(PAD_L, rulerY, W - PAD_L - PAD_R, rulerH);
    // Ruler ticks and labels
    ctx.fillStyle = 'rgba(200,200,200,0.7)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    const mmStep = Math.pow(10, Math.floor(Math.log10(effLen / 8)));
    for (let mm = 0; mm <= effLen; mm += mmStep) {
      const x = PAD_L + mm * eSc;
      if (x > W - PAD_R + 5) break;
      ctx.fillText(`${mm}`, x, rulerY + 12);
      // Faint grid lines extending through the section
      ctx.strokeStyle = 'rgba(150,150,150,0.12)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, rulerY + rulerH); ctx.lineTo(x, y + sectionH); ctx.stroke();
    }

    // --- Row 2: Tab labels (C1, C2, ...) ---
    const labelY = rulerY + rulerH + 6;

    // --- Row 3: Tab marker lines ---
    const stripY = labelY + labelH + tabLineH;

    // --- Row 4: Electrode strip ---
    const x0 = PAD_L;
    const w = effLen * eSc;

    ctx.fillStyle = hexToRgba(color, 0.15);
    ctx.fillRect(x0, stripY, w, stripH);
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.strokeRect(x0, stripY, w, stripH);

    // Length label inside strip (faint)
    if (w > 100) {
      ctx.fillStyle = hexToRgba(color, 0.25); ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(effLen)} mm`, x0 + w / 2, stripY + stripH / 2 + 4);
    }

    // --- Tab markers + labels + distances ---
    tabs.forEach((tab, ti) => {
      const relPos = tab.arcLen - layer.off;
      if (relPos < 0 || relPos > effLen) return;
      const tx = PAD_L + relPos * eSc;

      // Tab label above (uniform height)
      ctx.fillStyle = color; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${prefix}${tab.idx}`, tx, labelY + 12);

      // Vertical line from label down to strip
      ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(tx, labelY + labelH); ctx.lineTo(tx, stripY); ctx.stroke();

      // Small triangle at strip top
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tx, stripY + 3);
      ctx.lineTo(tx - 3, stripY - 1);
      ctx.lineTo(tx + 3, stripY - 1);
      ctx.closePath(); ctx.fill();

      // Distance label below strip (uniform height)
      ctx.fillStyle = color; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${relPos.toFixed(0)}mm`, tx, stripY + stripH + 13);
    });

    // --- Spacing annotations inside the strip ---
    for (let i = 1; i < tabs.length; i++) {
      const rel1 = tabs[i-1].arcLen - layer.off;
      const rel2 = tabs[i].arcLen - layer.off;
      const x1 = PAD_L + rel1 * eSc;
      const x2 = PAD_L + rel2 * eSc;
      const midX = (x1 + x2) / 2;
      const spY = stripY + stripH / 2;
      if (x2 - x1 > 30) {
        // Horizontal bracket
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x1 + 3, spY); ctx.lineTo(x2 - 3, spY); ctx.stroke();
        // End ticks
        ctx.beginPath(); ctx.moveTo(x1 + 3, spY - 3); ctx.lineTo(x1 + 3, spY + 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2 - 3, spY - 3); ctx.lineTo(x2 - 3, spY + 3); ctx.stroke();
        // Value
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${tabs[i].spacing ? tabs[i].spacing.toFixed(0) : ''}`, midX, spY - 3);
      }
    }

    y += sectionH + sectionGap;
  });
}

