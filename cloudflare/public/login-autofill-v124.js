const appRoot = document.getElementById('app');

const observer = new MutationObserver(enhanceUidLogin);
if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });

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
