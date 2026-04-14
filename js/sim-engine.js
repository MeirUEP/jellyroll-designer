// ========== SIMULATION ENGINE (Phase-Based Winder Model) ==========
function runSimulation() {
  const r0 = params.mandrel_d / 2;
  const targetR = params.target_od / 2;
  const openEndedTypes = new Set(['anode', 'cathode', 'separator']);

  // Classify layers
  const separators = layers.filter(l => l.type === 'separator');
  const cathode = layers.find(l => l.type === 'cathode');
  const anode = layers.find(l => l.type === 'anode');
  const allLayers = layers.filter(l => l.type !== 'mandrel');

  // Reset computed state
  allLayers.forEach(l => { l.off = -1; l.computedLen = 0; });

  // Pitch calculations — radius-dependent model
  // effective_pitch(r) = nominal_pitch / tension × (1 + k × r0 / r)
  // At inner radii (r ≈ r0): pitch inflated by (1+k) — separator wrinkling, air gaps
  // At outer radii (r >> r0): converges to nominal — tight winding
  const tension = Math.max(0.01, Math.min(1, params.tension_factor || 1));
  const gapK = Math.max(0, params.winding_gap_k || 0);

  // Nominal pitches (sum of layer thicknesses, no tension/gap adjustment)
  const nomSepPitch = separators.reduce((sum, l) => sum + l.t, 0);
  const sepAndCathLayers = layers.filter(l => l.type === 'separator' || l.type === 'cathode');
  const sepAndAnodLayers = layers.filter(l => l.type === 'separator' || l.type === 'anode');
  const nomPhase2Pitch = sepAndCathLayers.reduce((sum, l) => sum + l.t, 0);
  const nomAnodExtPitch = sepAndAnodLayers.reduce((sum, l) => sum + l.t, 0);
  const nomAllPitch = allLayers.reduce((sum, l) => sum + l.t, 0);

  // Radius-dependent pitch function — physically motivated model
  // Only SEPARATOR layers wrinkle at tight bending radii, creating air gaps.
  // Electrode (cathode/anode) thickness remains constant regardless of radius.
  // Model: sep_effective = sep_nominal × (1 + k × exp(-(r-r0)/r0))
  // Total pitch = (inflated sep thickness + constant electrode thickness) / tension
  //
  // This preserves electrode length better than inflating total pitch, because
  // the electrode arc per turn still grows with the inflated radius.
  function pitchAtR(nominalPitch, currentR) {
    if (gapK <= 0) return nominalPitch / tension;
    const dist = Math.max(0, currentR - r0);
    const decayLen = 2 * r0;  // characteristic decay length — wrinkling persists ~2× mandrel radii
    const sepInflation = gapK * Math.exp(-dist / decayLen);
    // Split nominal pitch into separator portion and electrode portion
    const sepFrac = nomSepPitch / Math.max(nominalPitch, 0.01);
    // Only inflate the separator fraction; electrode stays constant
    const inflatedPitch = nominalPitch * (1 + sepInflation * sepFrac);
    return inflatedPitch / tension;
  }

  // (All pitch calculations now use pitchAtR() per-step — no constant pitch variables needed)

  let r = r0;
  let arc = 0;
  let n = 0;
  const turns = [];
  let phaseInfo = { preTurns: 0, cathWindTurns: 0, mainTurns: 0 };

  // --- Helper: wind exact number of turns (supports fractional) ---
  function windTurns(numTurns, activeLayers, phaseName) {
    const nomPitch = activeLayers.reduce((sum, l) => sum + l.t, 0);
    if (nomPitch < 0.01) return;
    let remaining = numTurns;
    while (remaining > 0.001) {
      const frac = Math.min(remaining, 1.0);
      const pitch = pitchAtR(nomPitch, r);
      const circ = 2 * Math.PI * (r + pitch / 2);
      const arcInc = circ * frac;
      const rInc = pitch * frac;
      const arcStart = arc;
      arc += arcInc;
      r += rInc;
      n += frac;
      remaining -= frac;
      turns.push({ turn: n, r, arc, pitch, circ, arcStart, active: [...activeLayers], phase: phaseName, frac });
    }
  }

  // --- Helper: wind to target radius ---
  // mode: 'closest' = pick undershoot or overshoot whichever is closer (default)
  //        'undershoot' = always stop before exceeding target
  function windToRadius(tgtR, activeLayers, phaseName, mode = 'closest') {
    const nomPitch = activeLayers.reduce((sum, l) => sum + l.t, 0);
    if (nomPitch < 0.01) return;
    while (r < tgtR) {
      const pitch = pitchAtR(nomPitch, r);
      if (r + pitch > tgtR) {
        if (mode === 'undershoot') break;
        const undershoot = tgtR - r;
        const overshoot = (r + pitch) - tgtR;
        if (undershoot <= overshoot) break;
      }
      const circ = 2 * Math.PI * (r + pitch / 2);
      const arcStart = arc;
      arc += circ;
      r += pitch;
      n += 1;
      turns.push({ turn: n, r, arc, pitch, circ, arcStart, active: [...activeLayers], phase: phaseName });
    }
  }

  // ===== Phases 0–2: Overhang + Pre-wind + Cathode wind =====
  // Physical process:
  //   - Separator is inserted through the split mandrel slot, extending 129mm to the left.
  //   - Mandrel starts rotating. The left-side overhang wraps around simultaneously with
  //     the right-side continuous feed — doubling the separator pitch until overhang is consumed.
  //   - After pre_turns (1.5), cathode is fed in from the same angle as the separator feed.
  //   - After an additional min_cath_to_anod turns (1.8), anode is fed in from the same angle.
  //   - The overhang may still be wrapping when cathode enters (1.5 × π × mandrel_d < 129).

  separators.forEach(s => { s.off = 0; });
  const cathToAnodTurns = params.min_cath_to_anod || 0.5;
  const totalPreAnodeTurns = (params.pre_turns || 0) + cathToAnodTurns;
  let overhangRemaining = SEPARATOR_GRAB_DISTANCE; // mm of overhang left to wrap

  // Wind full turns through pre-wind + cathode-wind, consuming overhang.
  // Uses sub-steps internally for pitch changes (overhang consumed / cathode entry)
  // but emits one turn entry per full revolution for correct tab placement.
  const preWindStart = n;
  let cathodeEntered = false;
  let turnsRemaining = totalPreAnodeTurns;

  while (turnsRemaining > 0.001) {
    // This iteration covers one full turn (or final fractional turn)
    const turnFrac = Math.min(turnsRemaining, 1.0);
    const turnArcStart = arc;
    const turnRStart = r;
    const turnNStart = n;

    // Sub-step this turn at high resolution to track overhang + cathode entry
    const SUB_STEPS = 20;
    const subFrac = turnFrac / SUB_STEPS;
    let turnPitchSum = 0;

    for (let s = 0; s < SUB_STEPS; s++) {
      const cathodeActive = (n >= (params.pre_turns || 0) - 0.001);
      const doubleOH = overhangRemaining > 0.01;

      // Build nominal pitch from active layers at this sub-step
      let nomStep = doubleOH ? (2 * nomSepPitch) : nomSepPitch;
      if (cathodeActive && cathode) {
        nomStep += cathode.t;
        if (!cathodeEntered) {
          cathode.off = arc;
          cathodeEntered = true;
        }
      }
      // Apply radius-dependent gap + tension
      const stepPitch = pitchAtR(nomStep, r);

      const circ = 2 * Math.PI * (r + stepPitch / 2);
      arc += circ * subFrac;
      r += stepPitch * subFrac;
      n += subFrac;
      turnPitchSum += stepPitch;

      if (overhangRemaining > 0) {
        overhangRemaining = Math.max(0, overhangRemaining - circ * subFrac);
      }
    }

    turnsRemaining -= turnFrac;

    // Emit one turn entry for this full revolution
    const avgPitch = turnPitchSum / SUB_STEPS;
    const turnCirc = arc - turnArcStart;  // actual arc for this turn (accounts for pitch changes)
    const cathodeActive = (turnNStart >= (params.pre_turns || 0) - 0.001);
    let phase;
    if (turnNStart < (params.pre_turns || 0) - 0.001) phase = 'pre_wind';
    else phase = 'cathode_wind';

    turns.push({
      turn: n, r, arc, pitch: avgPitch, circ: turnCirc / turnFrac, arcStart: turnArcStart,
      active: cathodeActive && cathode ? [...separators, cathode] : [...separators],
      phase, frac: turnFrac
    });
  }

  if (cathode && !cathodeEntered) cathode.off = arc;
  phaseInfo.preTurns = Math.min(n, params.pre_turns || 0);
  phaseInfo.cathWindTurns = cathToAnodTurns;
  phaseInfo.cathToAnodTurns = cathToAnodTurns;

  // ===== Phase 3: Main wind (all layers) =====
  // The machine winds a fixed number of main-wind turns (default 9).
  // The resulting OD is determined by geometry, not the other way around.
  // Also cap at targetR - estimated anode extension pitch.
  if (anode) anode.off = arc;
  const mainWindStart = n;
  const maxMainTurns = 9;  // machine hard limit
  const estAnodExtPitch = pitchAtR(nomAnodExtPitch, targetR);  // pitch at outer radius for extension
  const electrodeTargetR = targetR - estAnodExtPitch;
  let mainTurnsDone = 0;
  if (nomAllPitch > 0.01 && electrodeTargetR > r) {
    // Full turns (limited by both target radius and max turn count)
    // Pitch varies with radius at each turn
    while (mainTurnsDone < maxMainTurns) {
      const turnPitch = pitchAtR(nomAllPitch, r);
      if (r + turnPitch > electrodeTargetR) break;
      const circ = 2 * Math.PI * (r + turnPitch / 2);
      const arcStart = arc;
      arc += circ;
      r += turnPitch;
      n += 1;
      mainTurnsDone += 1;
      turns.push({ turn: n, r, arc, pitch: turnPitch, circ, arcStart, active: [...allLayers], phase: 'main_wind' });
    }
    // Fractional last turn only if we haven't hit the turn limit
    if (mainTurnsDone < maxMainTurns) {
      const remainingR = electrodeTargetR - r;
      if (remainingR > 0.01) {
        const turnPitch = pitchAtR(nomAllPitch, r);
        const frac = remainingR / turnPitch;
        const circ = 2 * Math.PI * (r + turnPitch / 2);
        const arcInc = circ * frac;
        const arcStart = arc;
        arc += arcInc;
        r += remainingR;
        n += frac;
        turns.push({ turn: n, r, arc, pitch: turnPitch, circ, arcStart, active: [...allLayers], phase: 'main_wind', frac });
      }
    }
  }
  phaseInfo.mainTurns = n - mainWindStart;

  // Record electrode computed lengths at end of main wind.
  // Cathode ends here. Anode may be adjusted after tab clearance check.
  if (cathode && cathode.off >= 0) cathode.computedLen = arc - cathode.off;
  if (anode && anode.off >= 0) anode.computedLen = arc - anode.off;
  const anodeArcAtMainEnd = arc;

  // ===== Phase 4: Constraint Solver for Tab Placement =====
  // The solver sweeps the first cathode tab position within its allowed range
  // and finds the placement that maximizes tabs and electrode length while
  // satisfying all angular clearance constraints.

  function layerMidR(turnIdx, targetLayer) {
    const t = turns[turnIdx];
    const prevR = turnIdx > 0 ? turns[turnIdx-1].r : r0;
    const bandW = t.r - prevR;
    const totalThick = t.active.reduce((sum, l) => sum + l.t, 0);
    if (totalThick <= 0) return t.r;
    let cumThick = 0;
    for (const l of t.active) {
      if (l === targetLayer) return prevR + bandW * (cumThick + l.t / 2) / totalThick;
      cumThick += l.t;
    }
    return t.r;
  }

  function computeDrillAngle(firstArc) {
    for (let ti = 0; ti < turns.length; ti++) {
      const t = turns[ti];
      if (firstArc >= t.arcStart && firstArc < t.arc) {
        return (firstArc - t.arcStart) / t.circ * 360;
      }
    }
    if (turns.length > 0) {
      const lastT = turns[turns.length - 1];
      const firstT = turns[0];
      if (firstArc < firstT.arcStart) return ((firstArc / firstT.circ) % 1) * 360;
      return (((firstArc - lastT.arcStart) / lastT.circ) % 1) * 360;
    }
    return 0;
  }

  function effectiveLen(l) {
    return openEndedTypes.has(l.type) ? (l.computedLen || l.len || 0) : (l.len || 0);
  }

  // Angular distance between two angles (0–360), accounting for wrap
  function angDist(a, b) {
    const d = Math.abs(((a - b) % 360 + 360) % 360);
    return Math.min(d, 360 - d);
  }

  // Check if angle is within a zone (center ± halfWidth), accounting for wrap
  function inZone(angle, center, halfWidth) {
    return angDist(angle, center) < halfWidth;
  }

  // Compute angular position at a given arc length
  function arcToAngle(arcPos) {
    for (let ti = 0; ti < turns.length; ti++) {
      const t = turns[ti];
      if (arcPos >= t.arcStart && arcPos < t.arc) {
        return ((arcPos - t.arcStart) / t.circ * 360) % 360;
      }
    }
    if (turns.length > 0) {
      const lastT = turns[turns.length - 1];
      return ((arcPos - lastT.arcStart) / lastT.circ * 360) % 360;
    }
    return 0;
  }

  // Constraint parameters
  const tabZoneHalf = params.tab_zone_half_deg || 10;
  const minClearance = params.min_clearance_deg || 30;
  const keepOutHalf = tabZoneHalf + minClearance;  // total keep-out from tab zone center
  const IN_TO_MM = 25.4;
  const cathTabMinMm = (params.first_cath_tab_min_in || 4.5) * IN_TO_MM;
  const cathTabMaxMm = (params.first_cath_tab_max_in || 5.0) * IN_TO_MM;
  const anodTabMinMm = (params.first_anod_tab_min_in || 6.0) * IN_TO_MM;
  const anodTabMaxMm = (params.first_anod_tab_max_in || 6.5) * IN_TO_MM;
  const lengthTol = params.length_tolerance || 5;

  // Compute fixed angular positions (determined by machine constants)
  const cathStartAngle = cathode ? arcToAngle(cathode.off) : 0;
  const anodStartAngle = anode ? arcToAngle(anode.off) : 0;

  // === Solver: sweep first cathode tab position ===
  // Two-pass approach:
  //   Pass 1: Collect all valid candidates (constraints met + anode tab in range)
  //   Pass 2: Rank by max tabs, then max electrode length among ties
  const STEP = 1.0; // mm step for sweep (1mm ≈ 1.4° at outer radius — sufficient for 30° constraints)
  const candidates = [];

  function evaluateCandidate(cathTabMm) {
    const firstCathArcAbs = (cathode ? cathode.off : 0) + cathTabMm;
    const drillAng = computeDrillAngle(firstCathArcAbs);
    const anodAng = (drillAng + 180) % 360;

    // Inner zone: cathode start & anode start vs tab zones & each other
    const innerOk = angDist(cathStartAngle, drillAng) >= keepOutHalf &&
                    angDist(cathStartAngle, anodAng) >= keepOutHalf &&
                    angDist(anodStartAngle, drillAng) >= keepOutHalf &&
                    angDist(anodStartAngle, anodAng) >= keepOutHalf &&
                    angDist(cathStartAngle, anodStartAngle) >= minClearance;

    // Place cathode tabs using circumference-stepping model.
    // The drill angle determines the first tab position. Subsequent tabs are
    // exactly one turn's circumference apart — matching the physical reality
    // that consecutive drill intersections are one revolution of electrode apart.
    const trialCTabs = [];
    if (cathode) {
      let prevTabArc = -Infinity;
      for (let ti = 0; ti < turns.length; ti++) {
        const t = turns[ti];
        let tabArc;
        if (trialCTabs.length === 0) {
          // First tab: use drill angle to find initial position
          tabArc = t.arcStart + (drillAng / 360) * t.circ;
        } else {
          // Subsequent tabs: step forward by one revolution's arc length.
          // Add π×pitch to the turn circ to account for radius growth during
          // the revolution (half-pitch correction, independent of drill angle).
          const prevTab = trialCTabs[trialCTabs.length - 1];
          const prevTurn = turns[prevTab.turnIdx];
          tabArc = prevTab.arcLen + prevTurn.circ + Math.PI * prevTurn.pitch;
        }
        if (tabArc >= t.arc || tabArc < t.arcStart) continue;  // outside this turn
        if (tabArc < firstCathArcAbs) continue;
        if (tabArc >= cathode.off && tabArc < cathode.off + effectiveLen(cathode)) {
          const cathInActive = t.active.find(l => l.name === cathode.name);
          if (cathInActive) {
            trialCTabs.push({ turn: t.turn, r: layerMidR(ti, cathInActive), pitch: t.pitch, arcLen: tabArc, idx: trialCTabs.length + 1, circ: t.circ, angleDeg: drillAng, turnIdx: ti });
          }
        }
      }
    }

    // Place anode tabs (same circumference-stepping model)
    const trialATabs = [];
    const firstCathTabTurn = trialCTabs.length > 0 ? trialCTabs[0].turn : 0;
    const firstAnodArcAbs = anode ? anode.off + anodTabMinMm : 0;
    if (anode) {
      for (let ti = 0; ti < turns.length; ti++) {
        const t = turns[ti];
        if (t.turn < firstCathTabTurn) continue;
        let tabArc;
        if (trialATabs.length === 0) {
          // First tab: use anode angle to find initial position
          tabArc = t.arcStart + (anodAng / 360) * t.circ;
        } else {
          // Subsequent tabs: step forward by one revolution's arc length.
          const prevTab = trialATabs[trialATabs.length - 1];
          const prevTurn = turns[prevTab.turnIdx];
          tabArc = prevTab.arcLen + prevTurn.circ + Math.PI * prevTurn.pitch;
        }
        if (tabArc >= t.arc || tabArc < t.arcStart) continue;
        if (tabArc < firstAnodArcAbs) continue;
        if (tabArc >= anode.off && tabArc < anode.off + effectiveLen(anode)) {
          const anodInActive = t.active.find(l => l.name === anode.name);
          if (anodInActive) {
            trialATabs.push({ turn: t.turn, r: layerMidR(ti, anodInActive), pitch: t.pitch, arcLen: tabArc, idx: trialATabs.length + 1, circ: t.circ, angleDeg: anodAng, turnIdx: ti });
          }
        }
      }
    }

    // Validate first anode tab position along anode strip
    const firstAnodTabAlongAnode = trialATabs.length > 0 && anode ? trialATabs[0].arcLen - anode.off : -1;
    const anodTabRangeOk = firstAnodTabAlongAnode >= anodTabMinMm && firstAnodTabAlongAnode <= anodTabMaxMm;

    // Outer zone: adjust electrode ends to avoid tab zones and each other.
    // Cathode end: tight tolerance (±lengthTol) — cut length is controlled.
    // Anode end: full flexibility (up to one outer circumference) — just needs
    // to avoid cathode end angle and both tab zone angles.
    let cathEndArc = cathode ? cathode.off + effectiveLen(cathode) : 0;
    let anodEndArc = anode ? anode.off + effectiveLen(anode) : 0;
    let bestCathEndArc = cathEndArc;
    let bestAnodEndArc = anodEndArc;
    let outerOk = false;
    const outerCirc = turns.length > 0 ? turns[turns.length - 1].circ : 200;

    // Sweep cathode end within ±lengthTol
    for (let adj = 0; adj <= lengthTol && !outerOk; adj += 1) {
      for (const sign of [0, -1, 1]) {
        const tryCathEnd = cathEndArc + sign * adj;
        const tryCathAng = arcToAngle(tryCathEnd);
        if (angDist(tryCathAng, drillAng) < keepOutHalf) continue;
        if (angDist(tryCathAng, anodAng) < keepOutHalf) continue;
        // Anode end: sweep forward up to one full outer circumference
        // Prefer shortest extension that clears all constraints
        for (let adj2 = 0; adj2 <= outerCirc; adj2 += 1) {
          const tryAnodEnd = anodEndArc + adj2;  // only extend forward, never shorten
          const tryAnodAng = arcToAngle(tryAnodEnd);
          if (angDist(tryAnodAng, drillAng) < keepOutHalf) continue;
          if (angDist(tryAnodAng, anodAng) < keepOutHalf) continue;
          if (angDist(tryCathAng, tryAnodAng) < minClearance) continue;
          // Valid — pick first (shortest) valid extension
          bestCathEndArc = tryCathEnd;
          bestAnodEndArc = tryAnodEnd;
          outerOk = true;
          break;
        }
        if (outerOk) break;
      }
    }

    const cathEndAngle = arcToAngle(bestCathEndArc);
    const anodEndAngle = arcToAngle(bestAnodEndArc);
    const constraintsOk = innerOk && outerOk && anodTabRangeOk;
    const totalTabs = trialCTabs.length + trialATabs.length;
    const totalLen = (bestCathEndArc - (cathode ? cathode.off : 0)) + (bestAnodEndArc - (anode ? anode.off : 0));

    return {
      cathTabMm, firstCathArcAbs, drillAng, anodAng,
      cTabs: trialCTabs, aTabs: trialATabs,
      firstAnodTabAlongAnode,
      cathEndAngle, anodEndAngle, cathStartAngle, anodStartAngle,
      bestCathEndArc, bestAnodEndArc,
      innerOk, outerOk, anodTabRangeOk, constraintsOk,
      totalTabs, totalLen,
    };
  }

  // Pass 1: Evaluate all candidates
  for (let cathTabMm = cathTabMinMm; cathTabMm <= cathTabMaxMm; cathTabMm += STEP) {
    candidates.push(evaluateCandidate(cathTabMm));
  }

  // Pass 2: Select best solution
  // Priority: valid solutions first, then max tabs, then max electrode length
  const validCandidates = candidates.filter(c => c.constraintsOk);
  let bestSolution;

  if (validCandidates.length > 0) {
    // Among valid: sort by tabs descending, then total length descending
    validCandidates.sort((a, b) => {
      if (b.totalTabs !== a.totalTabs) return b.totalTabs - a.totalTabs;
      return b.totalLen - a.totalLen;
    });
    bestSolution = validCandidates[0];
  } else {
    // No valid solution — pick the one with fewest constraint violations
    // and best tab coverage as tiebreaker
    candidates.sort((a, b) => {
      const aViolations = (a.innerOk ? 0 : 1) + (a.outerOk ? 0 : 1) + (a.anodTabRangeOk ? 0 : 1);
      const bViolations = (b.innerOk ? 0 : 1) + (b.outerOk ? 0 : 1) + (b.anodTabRangeOk ? 0 : 1);
      if (aViolations !== bViolations) return aViolations - bViolations;
      if (b.totalTabs !== a.totalTabs) return b.totalTabs - a.totalTabs;
      return b.totalLen - a.totalLen;
    });
    bestSolution = candidates[0] || evaluateCandidate((cathTabMinMm + cathTabMaxMm) / 2);
  }

  // Apply best solution
  const cTabs = bestSolution.cTabs;
  const aTabs = bestSolution.aTabs;
  const drillAngleDeg = bestSolution.drillAng;
  const anodAngleDeg = bestSolution.anodAng;

  // Filter tabs based on weld-from-tab setting (skip unwelded inner tabs)
  const cathWeldFrom = Math.max(1, params.cath_weld_from_tab || 1);
  const anodWeldFrom = Math.max(1, params.anod_weld_from_tab || 1);
  const cTabsSkipped = cTabs.splice(0, cathWeldFrom - 1);
  const aTabsSkipped = aTabs.splice(0, anodWeldFrom - 1);
  cTabs.forEach((t, i) => { t.idx = i + 1; });
  aTabs.forEach((t, i) => { t.idx = i + 1; });

  for (let i = 1; i < cTabs.length; i++) cTabs[i].spacing = cTabs[i].arcLen - cTabs[i-1].arcLen;
  for (let i = 1; i < aTabs.length; i++) aTabs[i].spacing = aTabs[i].arcLen - aTabs[i-1].arcLen;

  // Build constraint warnings
  const constraints = [];
  if (!bestSolution.innerOk) {
    const details = [];
    if (angDist(bestSolution.cathStartAngle, drillAngleDeg) < keepOutHalf)
      details.push(`Cathode start (${bestSolution.cathStartAngle.toFixed(0)}°) too close to cathode tab zone`);
    if (angDist(bestSolution.cathStartAngle, anodAngleDeg) < keepOutHalf)
      details.push(`Cathode start (${bestSolution.cathStartAngle.toFixed(0)}°) too close to anode tab zone`);
    if (angDist(bestSolution.anodStartAngle, drillAngleDeg) < keepOutHalf)
      details.push(`Anode start (${bestSolution.anodStartAngle.toFixed(0)}°) too close to cathode tab zone`);
    if (angDist(bestSolution.anodStartAngle, anodAngleDeg) < keepOutHalf)
      details.push(`Anode start (${bestSolution.anodStartAngle.toFixed(0)}°) too close to anode tab zone`);
    if (angDist(bestSolution.cathStartAngle, bestSolution.anodStartAngle) < minClearance)
      details.push(`Cathode start (${bestSolution.cathStartAngle.toFixed(0)}°) too close to anode start (${bestSolution.anodStartAngle.toFixed(0)}°)`);
    constraints.push({ zone: 'Inner', ok: false, details });
  }
  if (!bestSolution.outerOk) {
    const details = [];
    if (angDist(bestSolution.cathEndAngle, drillAngleDeg) < keepOutHalf)
      details.push(`Cathode end (${bestSolution.cathEndAngle.toFixed(0)}°) too close to cathode tab zone`);
    if (angDist(bestSolution.cathEndAngle, anodAngleDeg) < keepOutHalf)
      details.push(`Cathode end (${bestSolution.cathEndAngle.toFixed(0)}°) too close to anode tab zone`);
    if (angDist(bestSolution.anodEndAngle, drillAngleDeg) < keepOutHalf)
      details.push(`Anode end (${bestSolution.anodEndAngle.toFixed(0)}°) too close to cathode tab zone`);
    if (angDist(bestSolution.anodEndAngle, anodAngleDeg) < keepOutHalf)
      details.push(`Anode end (${bestSolution.anodEndAngle.toFixed(0)}°) too close to anode tab zone`);
    if (angDist(bestSolution.cathEndAngle, bestSolution.anodEndAngle) < minClearance)
      details.push(`Cathode end (${bestSolution.cathEndAngle.toFixed(0)}°) too close to anode end (${bestSolution.anodEndAngle.toFixed(0)}°)`);
    constraints.push({ zone: 'Outer', ok: false, details });
  }

  // ===== Phase 4b: Anode extension =====
  // Anode extends past cathode end, but must keep end angle in a safe zone.
  let anodeExtended = false;
  let anodeEndArc = anodeArcAtMainEnd;
  phaseInfo.anodeExtTurns = 0;
  if (anode && anode.off >= 0 && r > 0) {
    const extPitch = pitchAtR(nomAnodExtPitch, r);  // pitch at current (outer) radius
    const circ = 2 * Math.PI * r;
    const lastTurn = turns[turns.length - 1];
    const currentAngle = lastTurn ? ((anodeArcAtMainEnd - lastTurn.arcStart) / lastTurn.circ * 360) % 360 : 0;

    // Sweep forward to find longest valid extension that stays within targetR
    // while avoiding both tab zones and cathode end angle
    const maxExtArc = (targetR + 1 - r) / extPitch * circ;  // allow up to 1mm over targetR
    let bestExtArc = 0;
    for (let tryArc = 1; tryArc < circ && tryArc <= maxExtArc; tryArc += 1) {
      const tryAngle = (currentAngle + tryArc / circ * 360) % 360;
      const okCathZone = angDist(tryAngle, drillAngleDeg) >= keepOutHalf;
      const okAnodZone = angDist(tryAngle, anodAngleDeg) >= keepOutHalf;
      const okCathEnd = angDist(tryAngle, bestSolution.cathEndAngle) >= minClearance;
      if (okCathZone && okAnodZone && okCathEnd && tryArc > bestExtArc) {
        bestExtArc = tryArc;
      }
    }

    if (bestExtArc > 0.01 && extPitch > 0) {
      anodeEndArc = anodeArcAtMainEnd + bestExtArc;
      anodeExtended = true;
      const frac = bestExtArc / (2 * Math.PI * (r + extPitch / 2));
      const extCirc = 2 * Math.PI * (r + extPitch / 2);
      const arcStart = arc;
      const rInc = extPitch * frac;
      arc += bestExtArc;
      r += rInc;
      n += frac;
      turns.push({ turn: n, r, arc, pitch: extPitch, circ: extCirc, arcStart, active: [...sepAndAnodLayers], phase: 'anode_ext', frac });
      phaseInfo.anodeExtTurns = frac;
    }
    anode.computedLen = anodeEndArc - anode.off;
  }

  // No final separator wrap — separator ends together with the anode.
  // Set separator computed lengths (separator runs from its offset to current arc).
  separators.forEach(s => { s.computedLen = arc - s.off; });
  phaseInfo.finalWrapTurns = 0;

  // Build result
  const outerR = turns.length > 0 ? turns[turns.length - 1].r : r0;
  const actualOD = outerR * 2;
  const pitches = turns.map(t => t.pitch);

  simResult = {
    turns, cTabs, aTabs, outerR,
    minPitch: pitches.length ? Math.min(...pitches) : 0,
    maxPitch: pitches.length ? Math.max(...pitches) : 0,
    drillAngleDeg, anodAngleDeg,
    targetOD: params.target_od,
    actualOD,
    anodeExtended,
    cathodeLen: cathode ? cathode.computedLen : 0,
    anodeLen: anode ? anode.computedLen : 0,
    phaseInfo,
    solver: bestSolution,
    constraints,
  };

  // Update drill angle info display
  const drillInfo = document.getElementById('drillAngleInfo');
  if (drillInfo) {
    const skipNote = (cTabsSkipped.length || aTabsSkipped.length) ? ` (skipped ${cTabsSkipped.length}C+${aTabsSkipped.length}A inner)` : '';
    const solvedTab = bestSolution.cathTabMm.toFixed(1);
    const anodTab = bestSolution.firstAnodTabAlongAnode >= 0 ? (bestSolution.firstAnodTabAlongAnode / IN_TO_MM).toFixed(2) + '"' : 'N/A';
    drillInfo.innerHTML =
      `Drill: <strong>${drillAngleDeg.toFixed(1)}°</strong>/<strong>${anodAngleDeg.toFixed(1)}°</strong> &bull; ` +
      `1st cath tab: <strong>${solvedTab}mm</strong> (${(bestSolution.cathTabMm / IN_TO_MM).toFixed(2)}") &bull; ` +
      `1st anod tab: <strong>${anodTab}</strong> &bull; ` +
      `${cTabs.length}C + ${aTabs.length}A tabs${skipNote}`;
  }

  // Update constraint warnings display
  const warnEl = document.getElementById('constraintWarnings');
  if (warnEl) {
    if (constraints.length === 0) {
      warnEl.innerHTML = '<span style="color:#16a34a">All angular constraints satisfied</span>';
      warnEl.style.background = 'rgba(22,163,106,0.1)';
    } else {
      const warnHtml = constraints.map(c =>
        `<div style="color:#ef4444"><strong>${c.zone} zone:</strong> ${c.details.join('; ')}</div>`
      ).join('');
      warnEl.innerHTML = warnHtml;
      warnEl.style.background = 'rgba(239,68,68,0.1)';
    }
  }

  document.getElementById('btnRun').classList.remove('needs-run');
  document.getElementById('runTs').textContent = new Date().toLocaleTimeString();
  computeCapacity();
  updateInfoBar();
  updateSummary();
  updateTable();
  renderView();

  // Update computed length displays in layer cards (without rebuilding full UI)
  document.querySelectorAll('.layer-props input[data-f="len"][readonly]').forEach(el => {
    const i = +el.dataset.i;
    const l = layers[i];
    if (l && l.computedLen) el.value = Math.round(l.computedLen);
  });
}

