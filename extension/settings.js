(() => {
  'use strict';
  const api = globalThis.ProtonCalentterShortcuts;
  const status = document.querySelector('#status');
  const reset = document.querySelector('#reset');
  const buttons = Object.fromEntries(['save', 'edit'].map(action => [action, document.getElementById(action)]));
  let shortcuts;
  let recording;
  function render() {
    for (const [action, button] of Object.entries(buttons)) {
      button.textContent = recording === action ? 'Press shortcut' : api.label(shortcuts[action]);
      button.setAttribute('aria-pressed', String(recording === action));
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
    const other = recording === 'save' ? 'edit' : 'save';
    if (api.matches(event, shortcuts[other])) { status.textContent = 'Already assigned'; return; }
    const next = { ...shortcuts, [recording]: shortcut };
    recording = null;
    void persist(next);
  }, true);
  reset.addEventListener('click', () => { recording = null; void persist(api.normalize()); });
  chrome.storage.local.get('shortcuts').then(result => {
    shortcuts = api.normalize(result.shortcuts);
    [...Object.values(buttons), reset].forEach(button => { button.disabled = false; });
    render();
  }).catch(() => { status.textContent = 'Could not load'; });
})();
