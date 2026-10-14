(() => {
  'use strict';

  const shortcutsAPI = globalThis.ProtonCalentterShortcuts;
  let shortcuts = shortcutsAPI.normalize();
  let features = shortcutsAPI.normalizeFeatures();
  const settingsReady = chrome.storage.local.get(['shortcuts', 'features']).then(result => {
    shortcuts = shortcutsAPI.normalize(result.shortcuts);
    features = shortcutsAPI.normalizeFeatures(result.features);
    document.querySelectorAll('.eventpopover').forEach(enhance);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shortcuts) shortcuts = shortcutsAPI.normalize(changes.shortcuts.newValue);
    if (area === 'local' && changes.features) {
      features = shortcutsAPI.normalizeFeatures(changes.features.newValue);
      if (!features.delete) { cancelDelete?.(); clearUndo?.(); cancelRestore?.(); forgetUndo(); }
      if (!features.edit) cancelEdit?.();
      document.querySelectorAll('.eventpopover').forEach(enhance);
    }
  });

  const bars = new WeakMap();
  const urlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;
  const blockedProtocols = new Set([
    'javascript:', 'vbscript:', 'data:', 'blob:', 'file:', 'filesystem:',
    'about:', 'chrome:', 'chrome-extension:', 'chrome-untrusted:',
    'edge:', 'resource:', 'view-source:'
  ]);

  function trimURL(raw) {
    let url = raw.replace(/[.,;:!?]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
    }
    return url.replace(/[.,;:!?]+$/, '');
  }

  function linkify(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('a, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.textContent;
      const fragment = document.createDocumentFragment();
      let end = 0;
      for (const match of text.matchAll(urlPattern)) {
        const display = trimURL(match[0]);
        const href = /^www\./i.test(display) ? `https://${display}` : display;
        let protocol;
        try {
          protocol = new URL(href).protocol;
          if (blockedProtocols.has(protocol)) continue;
        } catch { continue; }
        fragment.append(document.createTextNode(text.slice(end, match.index)));
        const link = document.createElement('a');
        link.href = href;
        link.textContent = display;
        if (protocol === 'http:' || protocol === 'https:') link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dataset.pcalLink = '';
        link.addEventListener('click', event => event.stopPropagation());
        fragment.append(link);
        end = match.index + display.length;
      }
      if (end) {
        fragment.append(document.createTextNode(text.slice(end)));
        node.replaceWith(fragment);
      }
    }
  }

  function getTitle(popover) {
    const title = popover.querySelector('.eventpopover-title');
    return (title?.getAttribute('title') || title?.textContent || '').trim();
  }
  function getDescription(popover) {
    const description = popover.querySelector('.text-pre-wrap');
    return (description?.innerText || description?.textContent || '').trim();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch { /* Older clipboard implementations may need execCommand. */ }
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(textarea);
    textarea.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Copy failed');
    } finally {
      textarea.remove();
      focused?.focus({ preventScroll: true });
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }

  function makeCopyButton(label, readText) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-small button-ghost-weak pcal-copy-button';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M5.5 4V2.5h8v8H12M2.5 5.5h8v8h-8z');
    svg.append(path);
    const caption = document.createElement('span');
    caption.textContent = label;
    caption.setAttribute('aria-live', 'polite');
    button.append(svg, caption);
    let timer;
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await copyText(readText());
        caption.textContent = 'Copied';
      } catch {
        caption.textContent = 'Failed';
      }
      clearTimeout(timer);
      timer = setTimeout(() => { caption.textContent = label; }, 1200);
    });
    return button;
  }

  function enhance(popover) {
    if (!popover.isConnected) return;
    const title = popover.querySelector('.eventpopover-title');
    for (const element of popover.querySelectorAll('.eventpopover-title, .text-pre-wrap')) {
      if (features.links) linkify(element);
      else element.querySelectorAll('a[data-pcal-link]').forEach(link => link.replaceWith(...link.childNodes));
    }
    if (!features.copy) { bars.get(popover)?.remove(); bars.delete(popover); return; }
    const body = popover.querySelector('.eventpopover-header')?.nextElementSibling;
    if (!title || !body) return;
    let bar = bars.get(popover);
    if (!bar || !body.contains(bar)) {
      bar?.remove();
      bar = document.createElement('div');
      bar.className = 'pcal-copy-bar';
      bar.append(
        makeCopyButton('Copy title', () => getTitle(popover)),
        makeCopyButton('Copy description', () => getDescription(popover)),
        makeCopyButton('Copy both', () => {
          const description = getDescription(popover);
          return getTitle(popover) + (description ? `\n${description}` : '');
        })
      );
      bars.set(popover, bar);
      body.prepend(bar);
    }
    const hasDescription = !!getDescription(popover);
    for (const button of Array.from(bar.children).slice(1)) {
      button.disabled = !hasDescription;
      button.title = hasDescription ? '' : 'No description';
    }
  }

  const pending = new Set();
  let frame;
  function collect(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return;
    const popover = element.closest('.eventpopover');
    if (popover) pending.add(popover);
    element.querySelectorAll('.eventpopover').forEach(item => pending.add(item));
  }
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      // Only look for new popovers in added subtrees; do not rescan the whole body.
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      const popover = element?.closest('.eventpopover');
      if (popover) pending.add(popover);
      mutation.addedNodes.forEach(collect);
    }
    if (!frame && pending.size) frame = requestAnimationFrame(() => {
      frame = 0;
      const batch = [...pending];
      pending.clear();
      batch.forEach(enhance);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  function visible(element) {
    return !!element?.getClientRects().length && !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility === 'visible';
  }
  function available(button) {
    return visible(button) && !button.matches(':disabled') &&
      button.getAttribute('aria-disabled') !== 'true' && button.getAttribute('aria-busy') !== 'true';
  }
  function typing(element) {
    return element instanceof HTMLElement && (element.isContentEditable ||
      !!element.closest('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]'));
  }
  function activeSurface(target) {
    // Use the innermost visible dialog, excluding underlying event cards.
    const dialogs = [...document.querySelectorAll('.modal-two-dialog-container, [role="dialog"], [aria-modal="true"]')].filter(visible);
    const inner = dialogs.filter(dialog => !dialogs.some(other => other !== dialog && dialog.contains(other)));
    if (inner.length) return inner.at(-1);
    const popovers = [...document.querySelectorAll('.eventpopover')].filter(visible);
    const focused = target instanceof Element ? target.closest('.eventpopover') : null;
    return focused && visible(focused) ? focused : popovers.length === 1 ? popovers[0] : null;
  }
  function editorDelete(surface) {
    if (!surface?.querySelector('#event-title-input')) return null;
    return [...surface.querySelectorAll('.modal-two-footer button')]
      .find(button => button.textContent.trim() === 'Delete');
  }
  function confirmationDelete(surface) {
    if (!surface || surface.querySelector('#event-title-input')) return null;
    const heading = surface.querySelector('.modal-two-title, h1, h2')?.textContent.trim();
    if (!['Delete event', 'Delete recurring event'].includes(heading)) return null;
    return [...surface.querySelectorAll('button')].find(button => button.textContent.trim() === 'Delete');
  }
  let cancelDelete;
  function startDelete(surface, first, moreOptions, onConfirm, onAbort) {
    let stage = moreOptions ? 'editor' : 'confirm';
    let previous = surface;
    const existing = new Set(document.querySelectorAll('.modal-two-dialog-container, [role="dialog"], [aria-modal="true"]'));
    const observer = new MutationObserver(advance);
    const timer = setTimeout(abort, 3000);
    function cancel() {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('pointerdown', abort, true);
      document.removeEventListener('visibilitychange', abort);
      window.removeEventListener('blur', abort);
      cancelDelete = null;
    }
    function abort() {
      cancel();
      onAbort?.();
    }
    function advance() {
      if (!features.delete) return abort();
      const next = activeSurface(document.activeElement);
      if (!next || next === previous) return;
      // Only follow new dialogs created by this shortcut, never a pre-existing dialog.
      if (existing.has(next)) return abort();
      const button = stage === 'editor' ? editorDelete(next) : confirmationDelete(next);
      if (!button) return abort();
      if (!available(button)) return;
      const confirming = stage === 'confirm';
      if (confirming) cancel();
      else {
        stage = 'confirm';
        previous = next;
        existing.add(next);
      }
      button.click();
      if (confirming) onConfirm?.();
    }
    cancelDelete = abort;
    document.addEventListener('pointerdown', abort, true);
    document.addEventListener('visibilitychange', abort);
    window.addEventListener('blur', abort);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    first.click();
    advance();
  }
  // Undo for preview-card deletions. undo.js recreates the event through Proton's Duplicate action.
  let clearUndo;
  let undoDeletion;
  let cancelRestore;
  function forgetUndo() {
    document.dispatchEvent(new CustomEvent('proton-calentter:undo-forget'));
  }
  function captureUndo(card) {
    clearUndo?.();
    const duplicate = card.querySelector('[data-testid="event-popover:duplicate"]');
    // An uncaptured event resets the page-world handler, so a stale capture can never be restored.
    return !(duplicate || document).dispatchEvent(new CustomEvent('proton-calentter:undo-capture', { bubbles: true, cancelable: true })) &&
      !!duplicate;
  }
  function offerUndo() {
    clearUndo?.();
    const existing = new Set(document.querySelectorAll('.notification'));
    let notification;
    let limit = 0;
    const observer = new MutationObserver(update);
    // Offer undo only once Proton reports the deletion succeeded.
    let timer = setTimeout(clear, 10000);
    function clear(restoring) {
      observer.disconnect();
      clearTimeout(timer);
      document.querySelectorAll('.pcal-undo-button').forEach(button => button.remove());
      clearUndo = undoDeletion = null;
      if (!restoring) forgetUndo();
    }
    // Undo stays available while the notification shows, for at least ten seconds and at most one minute.
    function expire() {
      if (notification.isConnected && performance.now() < limit) timer = setTimeout(expire, 1000);
      else clear();
    }
    function update() {
      if (!notification) {
        notification = [...document.querySelectorAll('.notification')].find(item => !existing.has(item) &&
          item.querySelector('.notification__content')?.textContent.trim() === 'Event deleted');
        if (!notification) return;
        clearTimeout(timer);
        limit = performance.now() + 60000;
        timer = setTimeout(expire, 10000);
      }
      if (!notification.isConnected || notification.querySelector('.pcal-undo-button')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-small button-ghost-weak notification__button text-bold pcal-undo-button';
      button.textContent = 'Undo';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        undoDeletion?.();
      });
      const close = notification.querySelector('.notification__close-button');
      if (close) close.before(button);
      else notification.append(button);
    }
    undoDeletion = () => {
      if (!notification) return false;
      const close = notification.querySelector('.notification__close-button');
      clear(true);
      restoreEvent();
      close?.click();
      return true;
    };
    clearUndo = clear;
    observer.observe(document.body, { childList: true, subtree: true });
    update();
  }
  function restoreEvent() {
    cancelRestore?.();
    const existing = new Set(document.querySelectorAll('[data-testid="create-event-modal:save"]'));
    if (document.dispatchEvent(new CustomEvent('proton-calentter:undo-restore', { cancelable: true }))) return;
    const observer = new MutationObserver(advance);
    const timer = setTimeout(cancel, 5000);
    function cancel() {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
      cancelRestore = null;
    }
    // Save the editor that Duplicate opens; interruptions leave it open for the user.
    function advance() {
      if (!features.delete) return cancel();
      const save = [...document.querySelectorAll('[data-testid="create-event-modal:save"]')].find(button => !existing.has(button));
      if (!available(save) || !activeSurface(document.activeElement)?.contains(save)) return;
      cancel();
      save.click();
    }
    cancelRestore = cancel;
    document.addEventListener('pointerdown', cancel, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    advance();
  }
  function activeCard(target) {
    if ([...document.querySelectorAll('.modal-two, .modal-two-dialog-container, [role="dialog"], [aria-modal="true"]')].some(visible)) return null;
    return activeSurface(target);
  }
  let cancelEdit;
  function navigateThenEdit(card, navigate) {
    const title = getTitle(card);
    const existing = new Set([...document.querySelectorAll('.eventpopover')].filter(visible));
    let lastAttempt = 0;
    const observer = new MutationObserver(advance);
    // React can populate the card in stages, and CSS visibility can change without a mutation.
    const retry = setInterval(advance, 50);
    const timer = setTimeout(cancel, 8000);
    function cancel() {
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(retry);
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
      cancelEdit = null;
    }
    function advance() {
      if (!features.edit) return cancel();
      if ([...document.querySelectorAll('#event-title-input')].some(visible)) return cancel();
      // Once Edit opens any dialog, leave its prompts and focus to Proton.
      if (lastAttempt && [...document.querySelectorAll('.modal-two, .modal-two-dialog-container, [role="dialog"], [aria-modal="true"]')].some(visible)) return cancel();
      const next = activeCard(document.activeElement);
      if (!next) return;
      // Follow only the navigated event, not another card already on screen.
      if (next !== card && existing.has(next)) return cancel();
      const edit = next.querySelector('[data-testid="event-popover:edit"]');
      const nextTitle = getTitle(next);
      if (!available(edit) || !nextTitle) return;
      if (nextTitle !== title) return cancel();
      // A rendered button can appear before Proton is ready to handle its click.
      // Keep the operation pending until an editor opens; throttle unsuccessful attempts.
      if (performance.now() - lastAttempt < 300) return;
      lastAttempt = performance.now();
      edit.click();
    }
    cancelEdit = cancel;
    document.addEventListener('pointerdown', cancel, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    navigate.click();
    advance();
  }
  // Wait for saved preferences before allowing shortcuts.
  settingsReady.then(() => document.addEventListener('keydown', event => {
    if (cancelEdit) {
      if (['Meta', 'Control', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) return;
      if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      cancelEdit();
    }
    if (cancelRestore && !['Meta', 'Control', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) cancelRestore();
    if (cancelDelete) {
      if (['Meta', 'Control', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) return;
      if (shortcutsAPI.matches(event, shortcuts.delete)) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      cancelDelete();
    }
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.target;
    let button;
    if (undoDeletion && event.key.toLowerCase() === 'z' && event.metaKey !== event.ctrlKey && !event.altKey && !event.shiftKey &&
        !typing(target) && !typing(document.activeElement) &&
        ![...document.querySelectorAll('.modal-two, .modal-two-dialog-container, [role="dialog"], [aria-modal="true"]')].some(visible)) {
      if (!undoDeletion()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (features.delete && shortcutsAPI.matches(event, shortcuts.delete)) {
      const surface = activeSurface(target);
      if (!surface) return;
      // Unmodified custom shortcuts must not delete events while typing.
      if (!(event.metaKey || event.ctrlKey || event.altKey) && typing(target)) return;
      const confirm = confirmationDelete(surface);
      const more = surface.querySelector('[data-testid="create-event-popover:more-event-options"]');
      button = confirm || surface.querySelector('[data-testid="event-popover:delete"]') || editorDelete(surface) || more;
      if (!available(button)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (confirm) button.click();
      else {
        const restorable = button.matches('[data-testid="event-popover:delete"]') && captureUndo(surface);
        startDelete(surface, button, button === more, restorable ? offerUndo : undefined, restorable ? forgetUndo : undefined);
      }
      return;
    }
    if (features.save && shortcutsAPI.matches(event, shortcuts.save) && target instanceof HTMLTextAreaElement &&
        target.id === 'event-description-input' && !target.readOnly && !target.disabled) {
      button = target.closest('form')?.querySelector('[data-testid="create-event-modal:save"], [data-testid="create-event-popover:save"]');
    } else if (features.edit && shortcutsAPI.matches(event, shortcuts.edit) && !typing(target) && !typing(document.activeElement)) {
      const active = activeCard(target);
      button = active?.querySelector('[data-testid="event-popover:edit"]');
      if (!button) {
        const navigate = active?.querySelector('[data-testid="event-popover:open"]');
        if (!available(navigate)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateThenEdit(active, navigate);
        return;
      }
    } else if (features.navigate && shortcutsAPI.matches(event, shortcuts.navigate) &&
        !typing(target) && !typing(document.activeElement)) {
      // Preserve native activation of focused links and controls.
      if (target instanceof Element && target.closest('button, a, summary, [role="button"], [role="menuitem"], [role="option"]')) return;
      button = activeCard(target)?.querySelector('[data-testid="event-popover:open"]');
    }
    if (!available(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.click();
  }, true));
  // Plain Enter saves the full editor from any field except the description, or when nothing is focused.
  // Runs after Proton's own handlers so fields that already use Enter (guest suggestions, pickers) keep working.
  settingsReady.then(() => document.addEventListener('keydown', event => {
    if (!features.save || event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.isContentEditable || target.closest(
      'textarea, button, a, select, summary, [role="button"], [role="combobox"], [role="listbox"], [role="option"], [role="menuitem"]'
    )) return;
    let form = target.closest('form');
    if (!form) {
      // With no focused field or selected text, use the topmost dialog; never an editor behind another prompt.
      const surface = activeSurface(target);
      const unfocused = target === document.body || target === document.documentElement || !!surface?.contains(target);
      if (!unfocused || !document.getSelection()?.isCollapsed) return;
      form = surface;
    }
    const button = form?.querySelector('[data-testid="create-event-modal:save"]');
    if (!available(button)) return;
    event.preventDefault();
    button.click();
  }));
})();
