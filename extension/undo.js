(() => {
  'use strict';

  // Runs in the page's world, the only place Proton's React handlers can be reached.
  // Proton has no event trash, so undo reuses its Duplicate action, captured before deletion.
  let restore = null;
  function own(element, prefix) {
    const key = element && Object.keys(element).find(key => key.startsWith(prefix));
    return key ? element[key] : undefined;
  }
  function vevent(element) {
    for (let fiber = own(element, '__reactFiber$'); fiber; fiber = fiber.return) {
      const result = fiber.memoizedProps?.event?.data?.eventReadResult?.result;
      if (result) return Array.isArray(result) ? result[0]?.veventComponent : undefined;
    }
  }
  document.addEventListener('proton-calentter:undo-capture', event => {
    restore = null;
    const duplicate = own(event.target, '__reactProps$')?.onClick;
    const component = vevent(event.target);
    // A duplicate would not faithfully restore recurring events, and would re-invite participants.
    if (typeof duplicate !== 'function' || !component || component.rrule || component['recurrence-id'] ||
        component.attendee?.length) return;
    restore = duplicate;
    event.preventDefault();
  });
  document.addEventListener('proton-calentter:undo-restore', event => {
    const duplicate = restore;
    restore = null;
    if (!duplicate) return;
    try {
      duplicate();
      event.preventDefault();
    } catch { /* Proton changed its handler; leave the event deleted. */ }
  });
})();
