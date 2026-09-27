const appRoot = document.getElementById('app');

const observer = new MutationObserver(enhanceUidLogin);
if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });
document.addEventListener('submit', interceptAdminPasswordSubmit, true);

enhanceUidLogin();

function enhanceUidLogin() {
  const form = document.getElementById('login-form');
  const input = document.getElementById('uid');
  if (!form || !input || input.dataset.passwordManagerV124 === '1') return;

  input.dataset.passwordManagerV124 = '1';
  input.type = 'text';
  input.inputMode = 'text';
  input.name = 'username';
  input.autocomplete = 'username';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.enterKeyHint = 'go';
  input.removeAttribute('pattern');

  form.autocomplete = 'on';
  form.setAttribute('data-login-form', 'uid');
}

async function interceptAdminPasswordSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'admin-password-form') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const currentPassword = form.querySelector('#admin-current-password')?.value || '';
  const newPassword = form.querySelector('#admin-new-password')?.value || '';
  const confirm = form.querySelector('#admin-confirm-password')?.value || '';
  const status = form.querySelector('#admin-password-status');
  const button = form.querySelector('#admin-password-save');

  if (newPassword !== confirm) {
    if (status) status.textContent = 'New passwords do not match.';
    return;
  }
  if (newPassword.length < 14) {
    if (status) status.textContent = 'Use at least 14 characters.';
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Changing…';
  }

  try {
    const response = await fetch('/api/auth/admin-password', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);

    form.reset();
    if (status) status.textContent = 'Administrator password changed. Your current Admin session remains unlocked.';
  } catch (error) {
    if (status) status.textContent = error.message || String(error);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Change admin password';
    }
  }
}
