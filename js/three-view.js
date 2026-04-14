// ========== 3D VIEW (improved) ==========
function render3D() {
  if (!threeInited) init3D();
  update3DScene();
}

function init3D() {
  const container = document.getElementById('threeContainer');
  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#111827');

  threeCamera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 10000);
  threeRenderer = new THREE.WebGLRenderer({ antialias: true });
  threeRenderer.setSize(container.clientWidth, container.clientHeight);
  container.innerHTML = '';
  container.appendChild(threeRenderer.domElement);

  // Lights
  threeScene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.6); d1.position.set(200, 300, 200); threeScene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-200, 100, -200); threeScene.add(d2);

  // Orbit controls
  let isDragging = false, prevX = 0, prevY = 0;
  let azimuth = Math.PI / 4, elevation = Math.PI / 6, dist = 500; // ~30° elevation

  function updateCamera() {
    threeCamera.position.set(
      dist * Math.cos(elevation) * Math.sin(azimuth),
      dist * Math.sin(elevation),
      dist * Math.cos(elevation) * Math.cos(azimuth)
    );
    threeCamera.lookAt(0, params.cell_h * 0.4, 0);
  }

  threeRenderer.domElement.addEventListener('mousedown', e => { isDragging = true; prevX = e.clientX; prevY = e.clientY; });
  window.addEventListener('mouseup', () => isDragging = false);
  threeRenderer.domElement.addEventListener('mousemove', e => {
    if (!isDragging) return;
    azimuth += (e.clientX - prevX) * 0.005;
    elevation += (e.clientY - prevY) * 0.005;
    elevation = Math.max(-Math.PI/2.5, Math.min(Math.PI/2.5, elevation));
    prevX = e.clientX; prevY = e.clientY;
    updateCamera();
  });
  threeRenderer.domElement.addEventListener('wheel', e => {
    dist *= e.deltaY > 0 ? 1.1 : 0.9;
    dist = Math.max(50, Math.min(5000, dist));
    updateCamera(); e.preventDefault();
  }, { passive: false });

  threeControls = {
    updateCamera,
    setDist: d => { dist = d; updateCamera(); },
    resetView: () => { azimuth = Math.PI / 4; elevation = Math.PI / 6; updateCamera(); }
  };
  updateCamera();

  function animate() {
    requestAnimationFrame(animate);
    if (autoSpin) { azimuth += 0.005; updateCamera(); }
    threeRenderer.render(threeScene, threeCamera);
  }
  animate();
  threeInited = true;

  const ro = new ResizeObserver(() => {
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    threeCamera.aspect = container.clientWidth / container.clientHeight;
    threeCamera.updateProjectionMatrix();
    threeRenderer.setSize(container.clientWidth, container.clientHeight);
  });
  ro.observe(container);
}

function update3DScene() {
  if (!threeScene || !simResult) return;

  // Clear non-light children
  const toRemove = [];
  threeScene.children.forEach(c => { if (!c.isLight) toRemove.push(c); });
  toRemove.forEach(c => threeScene.remove(c));

  const s = simResult;
  // rScale controls radial exaggeration for layer visibility
  // slider=1: true proportions (OD/height ratio preserved exactly)
  // slider=20: layers 4x exaggerated
  // Real cell: OD ~88mm, height 222mm → true rScale = 1.0
  const userScale = +document.getElementById('p_rscale').value;
  const rScale = 0.5 + userScale * 0.25; // slider 1→0.75, 3→1.25, 8→2.5, 20→5.5
  const cutDeg = +document.getElementById('p_cut').value;
  const cutRad = cutDeg * Math.PI / 180;
  const cellH = params.cell_h;
  const mandrelR = params.mandrel_d / 2;

  // Mandrel as solid grey cylinder
  const mandrelGeo = new THREE.CylinderGeometry(mandrelR * rScale, mandrelR * rScale, cellH, 64);
  const mandrelMat = new THREE.MeshPhongMaterial({ color: 0x888899, transparent: true, opacity: 0.6 });
  const mandrelMesh = new THREE.Mesh(mandrelGeo, mandrelMat);
  mandrelMesh.position.y = cellH / 2;
  threeScene.add(mandrelMesh);

  // Build layer cylinders with actual radial thickness
  s.turns.forEach((turn, ti) => {
    const prevR = ti > 0 ? s.turns[ti-1].r : mandrelR;
    const innerR = prevR;
    const bandW = turn.r - innerR;
    const nActive = turn.active.length;
    if (nActive === 0) return;

    const totalThick3d = turn.active.reduce((sum, l) => sum + l.t, 0);
    let cumThick3d = 0;
    turn.active.forEach((layer, li) => {
      const rInner = (totalThick3d > 0 ? innerR + bandW * cumThick3d / totalThick3d : innerR) * rScale;
      const rOuter = (totalThick3d > 0 ? innerR + bandW * (cumThick3d + layer.t) / totalThick3d : turn.r) * rScale;
      cumThick3d += layer.t;
      const isElectrode = layer.type === 'cathode' || layer.type === 'anode';

      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(layer.color),
        transparent: true,
        opacity: isElectrode ? 0.9 : 0.7,
        side: THREE.DoubleSide
      });

      // Outer cylinder surface
      const geoO = new THREE.CylinderGeometry(rOuter, rOuter, cellH, 64, 1, true, 0, cutRad);
      const meshO = new THREE.Mesh(geoO, mat);
      meshO.position.y = cellH / 2;
      threeScene.add(meshO);

      // Inner cylinder surface
      const geoI = new THREE.CylinderGeometry(rInner, rInner, cellH, 64, 1, true, 0, cutRad);
      const meshI = new THREE.Mesh(geoI, mat.clone());
      meshI.position.y = cellH / 2;
      threeScene.add(meshI);

      // Top and bottom ring caps
      [0, cellH].forEach(yy => {
        const ring = new THREE.RingGeometry(rInner, rOuter, 64, 1, 0, cutRad);
        const ringMesh = new THREE.Mesh(ring, mat.clone());
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = yy;
        threeScene.add(ringMesh);
      });

      // Cross-section cut faces — filled colored rectangles at both cut edges
      if (cutDeg < 360) {
        const thickness = rOuter - rInner;
        const midR = (rInner + rOuter) / 2;
        const cutMat = new THREE.MeshPhongMaterial({
          color: new THREE.Color(layer.color),
          side: THREE.DoubleSide,
          opacity: 1.0, transparent: false
        });

        // Cut face at angle 0 — plane faces along +Z, so rotate to face Z direction
        const cutGeo1 = new THREE.PlaneGeometry(thickness, cellH);
        const cutMesh1 = new THREE.Mesh(cutGeo1, cutMat);
        // Position at midR along X axis, rotated to face +Z (perpendicular to radius)
        cutMesh1.position.set(midR, cellH/2, 0);
        cutMesh1.rotation.y = Math.PI / 2;
        threeScene.add(cutMesh1);

        // Cut face at cutaway angle
        const cutGeo2 = new THREE.PlaneGeometry(thickness, cellH);
        const cutMesh2 = new THREE.Mesh(cutGeo2, cutMat.clone());
        cutMesh2.position.set(midR * Math.cos(cutRad), cellH/2, midR * Math.sin(cutRad));
        cutMesh2.rotation.y = Math.PI / 2 + cutRad;
        threeScene.add(cutMesh2);
      }
    });
  });

  // Tabs — protruding vertically from the top of the cell
  // Three.js CylinderGeometry: angle 0 starts at +Z axis, goes CCW in XZ plane
  // Cell convention: 0° = +X (3 o'clock), 90° = +Z (12 o'clock when viewed top-down)
  // Convert cell angle to Three.js angle: threeAngle = cellAngle (both CCW from +Z for sin/cos)
  const tabH = params.tab_h;
  const tabW = params.tab_w;

  function addTabs(tabs, color, emissive, cellAngleDeg) {
    // 0° = top (12 o'clock). Three.js Y-up, XZ plane: offset by 90°
    const angRad = (cellAngleDeg + 90) * Math.PI / 180;
    tabs.forEach(tab => {
      const r = tab.r * rScale;
      // Tab: thin strip standing up from top face
      const tH = tabH * 1.5;  // shorter
      const tW = Math.max(tabW * 0.3, 2);  // thinner
      const geo = new THREE.BoxGeometry(tW, tH, 0.5);
      const mat = new THREE.MeshPhongMaterial({ color, emissive: emissive, emissiveIntensity: 0.4, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        r * Math.sin(angRad),
        cellH + tH / 2,
        r * Math.cos(angRad)
      );
      mesh.rotation.y = angRad;
      threeScene.add(mesh);

      // Add a bright edge outline for visibility
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      threeScene.add(edges);
    });
  }

  addTabs(s.cTabs, 0x3b82f6, 0x1a3a6b, s.drillAngleDeg);
  addTabs(s.aTabs, 0x16a34a, 0x0a4a22, s.anodAngleDeg);

  // Set camera distance
  const outerScaledR = s.outerR * rScale;
  const camDist = Math.max(outerScaledR * 3, cellH * 2.2);
  threeControls.setDist(camDist);
}

// 3D controls
document.getElementById('p_cut').addEventListener('input', e => {
  document.getElementById('p_cut_val').textContent = e.target.value;
  if (currentView === '3d') update3DScene();
});
document.getElementById('p_rscale').addEventListener('input', e => {
  document.getElementById('p_rscale_val').textContent = e.target.value;
  if (currentView === '3d') update3DScene();
});
document.getElementById('btnSpin').addEventListener('click', () => {
  autoSpin = !autoSpin;
  document.getElementById('btnSpin').textContent = autoSpin ? 'Stop spin' : 'Auto-spin';
});
document.getElementById('btnResetCam').addEventListener('click', () => {
  if (threeControls) threeControls.resetView();
});

// ========== CSV EXPORT ==========
