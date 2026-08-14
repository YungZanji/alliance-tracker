import './app-v081.js';

let scheduled = false;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(() => {
    scheduled = false;
    bindVerifiedGuestLogin();
  }, 40));
}

function bindVerifiedGuestLogin() {
  const button = document.getElementById('guest-login-button');
  const passwordInput = document.getElementById('guest-password');
  if (!button || button.dataset.sessionV107 === '1') return;
  button.dataset.sessionV107 = '1';

  // Capture-phase handlers run before the original v081 target handlers. This
  // keeps the existing Guest Access markup/styles while replacing only the
  // submit behavior with a verified session handoff.
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    submitVerifiedGuestLogin(button);
  }, true);

  passwordInput?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitVerifiedGuestLogin(button);
  }, true);
}

async function submitVerifiedGuestLogin(button) {
  const usernameInput = document.getElementById('guest-username');
  const passwordInput = document.getElementById('guest-password');
  const error = document.getElementById('guest-login-error');
  const username = String(usernameInput?.value || '').trim();
  const password = String(passwordInput?.value || '');

  if (!username || !password) {
    showError(error, 'Enter the guest username and password.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Signing in…';
  error?.classList.remove('show');

  try {
    await requestJson('/api/auth/guest-login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    button.textContent = 'Verifying access…';
    const session = await requestJson('/api/auth/me');
    if (!session?.user?.isGuest) {
      throw new Error('The guest password was accepted, but the portal session was not retained. Refresh and try again.');
    }

    location.hash = '#home';
    location.reload();
  } catch (err) {
    showError(error, err?.message || 'Guest login failed.');
    button.disabled = false;
    button.textContent = 'Open as Guest';
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(node, message) {
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
}
