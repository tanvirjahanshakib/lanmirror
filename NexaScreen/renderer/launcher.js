'use strict';

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.className = 'toast'), 3200);
}

document.getElementById('hostCard').addEventListener('click', async () => {
  await window.nexa.navigate('host.html');
});

document.getElementById('viewerCard').addEventListener('click', async () => {
  await window.nexa.navigate('viewer.html');
});

(async () => {
  try {
    const version = await window.nexa.getAppVersion();
    document.getElementById('appVersion').textContent = `v${version}`;
  } catch (_) {
    /* non-fatal */
  }
})();

window.nexa.onUpdateStatus((status) => {
  if (status.channel === 'available') showToast('A new update is downloading…');
  if (status.channel === 'downloaded') showToast('Update ready — restart to install.', 'success');
  if (status.channel === 'error') showToast('Update check failed.', 'error');
});
