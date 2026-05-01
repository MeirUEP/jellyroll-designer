// ========== AUTH (shared across all pages) ==========
// Landing page (index.html) handles the password gate and sets sessionStorage.
// Designer and inventory pages check for auth and redirect if missing.

// Mobile panel toggle (designer only)
function toggleMobilePanel() {
  const panel = document.getElementById('leftPanel');
  const btn = document.getElementById('mobileToggle');
  if (!panel || !btn) return;
  panel.classList.toggle('collapsed');
  btn.innerHTML = panel.classList.contains('collapsed') ? '&#9650; Controls' : '&#9660; Controls';
}

// Designer-specific auth check (called by designer.html on load)
function checkAuth() {
  const p = document.getElementById('authPass');
  if (!p) return;
  if (p.value === atob('WmluY0Fub2Rl')) {
    document.getElementById('authGate').classList.add('hidden');
    const appMain = document.getElementById('appMain');
    if (appMain) appMain.style.display = '';
    sessionStorage.setItem('jr_auth', '1');
    setTimeout(() => { window.dispatchEvent(new Event('resize')); if (typeof runSimulation === 'function') runSimulation(); }, 100);
  } else {
    document.getElementById('authErr').textContent = 'Incorrect password';
    p.value = '';
  }
}

// Auto-unlock if already authed (designer page fallback — auth gate was removed
// in favor of redirect, but keep this for any edge cases)
if (sessionStorage.getItem('jr_auth') === '1') {
  const gate = document.getElementById('authGate');
  if (gate) gate.classList.add('hidden');
  const appMain = document.getElementById('appMain');
  if (appMain) appMain.style.display = '';
}
