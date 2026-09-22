(() => {
  'use strict';
  const api = globalThis.ProtonCalentterShortcuts;
  const status = document.querySelector('#status');
  const reset = document.querySelector('#reset');
  const buttons = Object.fromEntries(Object.keys(api.defaults).map(action => [action, document.getElementById(action)]));
  const checkboxes = [...document.querySelectorAll('[data-feature]')];
  let features;
  let shortcuts;
  let recording;
  function render() {
    for (const [action, button] of Object.entries(buttons)) {
      button.textContent = recording === action ? 'Press shortcut' : api.label(shortcuts[action]);
      button.setAttribute('aria-pressed', String(recording === action));
      button.disabled = !features[action];
    }
  }
  async function persist(next) {
    try {
      await chrome.storage.local.set({ shortcuts: next });
      shortcuts = next;
      status.textContent = 'Saved';
    } catch { status.textContent = 'Could not save'; }
    render();
  }
  for (const [action, button] of Object.entries(buttons)) {
    button.addEventListener('click', () => {
      recording = recording === action ? null : action;
      status.textContent = recording ? 'Esc to cancel' : '';
      render();
    });
    button.addEventListener('blur', () => {
      if (recording === action) { recording = null; status.textContent = ''; render(); }
    });
  }
  document.addEventListener('keydown', event => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      recording = null;
      status.textContent = '';
      render();
      return;
    }
    if (event.repeat || event.isComposing) return;
    const shortcut = api.fromEvent(event);
    if (!api.valid(shortcut)) return;
    if (Object.keys(buttons).some(action => action !== recording && api.matches(event, shortcuts[action]))) {
      status.textContent = 'Already assigned'; return;
    }
    const next = { ...shortcuts, [recording]: shortcut };
    recording = null;
    void persist(next);
  }, true);
  reset.addEventListener('click', () => { recording = null; void persist(api.normalize()); });
  for (const checkbox of checkboxes) checkbox.addEventListener('change', async () => {
    const key = checkbox.dataset.feature;
    const previous = features[key];
    features = { ...features, [key]: checkbox.checked };
    checkbox.disabled = true;
    try {
      await chrome.storage.local.set({ features });
      status.textContent = 'Saved';
    } catch {
      features[key] = previous;
      checkbox.checked = previous;
      status.textContent = 'Could not save';
    }
    checkbox.disabled = false;
    render();
  });
  chrome.storage.local.get(['shortcuts', 'features']).then(result => {
    shortcuts = api.normalize(result.shortcuts);
    features = api.normalizeFeatures(result.features);
    checkboxes.forEach(checkbox => {
      checkbox.checked = features[checkbox.dataset.feature];
      checkbox.disabled = false;
    });
    [...Object.values(buttons), reset].forEach(button => { button.disabled = false; });
    render();
  }).catch(() => { status.textContent = 'Could not load'; });
})();
