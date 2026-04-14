// ========== AUTH GATE ==========
// Mobile panel toggle
function toggleMobilePanel() {
  const panel = document.getElementById('leftPanel');
  const btn = document.getElementById('mobileToggle');
  panel.classList.toggle('collapsed');
  btn.innerHTML = panel.classList.contains('collapsed') ? '&#9650; Controls' : '&#9660; Controls';
}

function checkAuth() {
  const p = document.getElementById('authPass').value;
  if (p === atob('WmluY0Fub2Rl')) {
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('appMain').style.display = '';
    sessionStorage.setItem('jr_auth', '1');
    setTimeout(() => { window.dispatchEvent(new Event('resize')); runSimulation(); }, 100);
  } else {
    document.getElementById('authErr').textContent = 'Incorrect password';
    document.getElementById('authPass').value = '';
  }
}
document.getElementById('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') checkAuth(); });
if (sessionStorage.getItem('jr_auth') === '1') {
  document.getElementById('authGate').classList.add('hidden');
  document.getElementById('appMain').style.display = '';
}

