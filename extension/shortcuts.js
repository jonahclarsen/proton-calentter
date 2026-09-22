(() => {
  'use strict';

  const defaults = {
    save: { key: 'Enter', meta: true, ctrl: false, alt: false, shift: false },
    edit: { key: 'e', meta: false, ctrl: false, alt: false, shift: false },
    delete: { key: 'r', meta: true, ctrl: false, alt: false, shift: true }
  };
  const modifierKeys = new Set(['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Unidentified', 'Dead']);
  function valid(value) {
    return value && typeof value.key === 'string' && value.key.length > 0 &&
      !modifierKeys.has(value.key) && value.key !== 'Escape' &&
      ['meta', 'ctrl', 'alt', 'shift'].every(key => typeof value[key] === 'boolean');
  }
  function normalize(value) {
    return Object.fromEntries(Object.entries(defaults).map(([action, fallback]) =>
      [action, valid(value?.[action]) ? value[action] : { ...fallback }]));
  }
  function fromEvent(event) {
    return { key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
      meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey };
  }
  function matches(event, shortcut) {
    const actual = fromEvent(event);
    return Object.keys(actual).every(key => actual[key] === shortcut[key]);
  }
  function label(shortcut) {
    return [shortcut.meta && 'Cmd', shortcut.ctrl && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift',
      shortcut.key === ' ' ? 'Space' :
        shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key].filter(Boolean).join(' + ');
  }
  function normalizeFeatures(value) {
    return Object.fromEntries(['links', 'copy', ...Object.keys(defaults)].map(key => [key, value?.[key] !== false]));
  }
  globalThis.ProtonCalentterShortcuts = { defaults, normalize, normalizeFeatures, fromEvent, matches, label, valid };
})();
