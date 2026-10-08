import { test as base, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const extensionPath = path.resolve('extension');
const fixture = await readFile(new URL('./fixtures/calendar.html', import.meta.url), 'utf8');
const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    // Fulfill every request locally: no account or real calendar data is involved.
    await context.route(/^https?:\/\//, route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await use(context);
    await context.close();
  },
  calendar: async ({ page, context }, use) => {
    await page.goto('https://calendar.proton.me/');
    await expect(page.locator('.pcal-copy-bar')).toBeVisible();
    const cdp = await context.newCDPSession(page);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    const world = worlds.find(world => world.origin.startsWith('chrome-extension://'));
    expect(world, 'Content script runs in an extension isolated world').toBeTruthy();
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', {
        contextId: world.id, expression, awaitPromise: true, returnByValue: true
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const id = await evaluate('chrome.runtime.id');
    // Stub clipboard inside the extension world, never touching the user's clipboard.
    await evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => {
      document.body.dataset.clipboard = text;
    } })`);
    await page.evaluate(() => {
      document.body.dataset.edits = '0';
      document.body.dataset.saves = '0';
      document.addEventListener('click', event => {
        if (event.target.closest('[data-testid="event-popover:edit"]')) {
          document.body.dataset.edits = String(Number(document.body.dataset.edits) + 1);
        }
      });
      document.addEventListener('submit', event => {
        event.preventDefault();
        document.body.dataset.saves = String(Number(document.body.dataset.saves) + 1);
        document.body.dataset.savedDescription = event.target.querySelector('textarea')?.value || '';
      });
    });
    await use({ page, id, evaluate });
  }
});

async function openEditor(page) {
  await page.evaluate(() => document.body.append(document.querySelector('#editor').content.cloneNode(true)));
  await page.locator('#event-description-input').focus();
}

test('linkifies URLs without altering text or nesting existing links', async ({ calendar: { page } }) => {
  const title = page.locator('.eventpopover-title');
  await expect(title.locator('a')).toHaveCount(2);
  await expect(title.locator('a').nth(1)).toHaveJSProperty('href', 'https://www.example.org/');
  await expect(title.locator('a').first()).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(title.locator('a').first()).toHaveAttribute('target', '_blank');
  await title.evaluate(element => {
    element.innerHTML = 'Read <strong>https://example.com/a_(b).</strong> <a href="https://example.org">Existing</a> javascript:alert(1)';
  });
  await expect(title.locator('strong a')).toHaveAttribute('href', 'https://example.com/a_(b)');
  await expect(title).toHaveText('Read https://example.com/a_(b). Existing javascript:alert(1)');
  await expect(title.locator('a')).toHaveCount(2);
  await expect(title.locator('a a')).toHaveCount(0);
  await page.evaluate(() => {
    window.bubbled = false;
    document.querySelector('.eventpopover').addEventListener('click', () => { window.bubbled = true; });
    const link = document.querySelector('.eventpopover-title a');
    link.addEventListener('click', event => event.preventDefault());
    link.click();
  });
  expect(await page.evaluate(() => window.bubbled)).toBe(false);
});

test('copies fresh title, multiline description, and both', async ({ calendar: { page } }) => {
  await page.getByRole('button', { name: 'Copy title', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-clipboard', 'Planning https://example.com/notes and WWW.example.org');
  await page.getByRole('button', { name: 'Copy description', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-clipboard', 'First line\nSecond line reference');
  await page.locator('.eventpopover-title').evaluate(element => element.setAttribute('title', 'Updated title'));
  await page.getByRole('button', { name: 'Copy both', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-clipboard', 'Updated title\nFirst line\nSecond line reference');
});

test('recovers after SPA body replacement and late descriptions without duplicating controls', async ({ calendar: { page } }) => {
  await page.locator('.eventpopover-body').evaluate(element => { element.innerHTML = '<div>Example calendar</div>'; });
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Copy description' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy both' })).toBeDisabled();
  await page.locator('.eventpopover-body').evaluate(element => {
    const description = document.createElement('div');
    description.className = 'text-pre-wrap';
    description.textContent = 'Loaded later';
    element.append(description);
  });
  await expect(page.getByRole('button', { name: 'Copy description' })).toBeEnabled();
  await page.getByRole('button', { name: 'Copy both' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-clipboard', /Loaded later$/);
  await page.locator('.eventpopover-title').evaluate(element => {
    element.textContent = 'https://example.net/new';
  });
  await expect(page.locator('.eventpopover-title a')).toHaveAttribute('href', 'https://example.net/new');
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(1);
  await page.evaluate(() => {
    const popover = document.querySelector('.eventpopover');
    const replacement = popover.cloneNode(true);
    replacement.querySelector('.pcal-copy-bar').remove();
    popover.replaceWith(replacement);
  });
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(1);
  await page.getByRole('button', { name: 'Copy title' }).click();
  await expect(page.locator('.pcal-copy-bar')).toContainText('Copied');
});

test('clipboard failures show Failed instead of false success', async ({ calendar: { page, evaluate } }) => {
  await evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw Error('denied'); } });
    document.execCommand = () => false;`);
  await page.getByRole('button', { name: 'Copy title' }).click();
  await expect(page.locator('.pcal-copy-bar')).toContainText('Failed');
  await expect(page.locator('body > textarea')).toHaveCount(0);
});

test('Command-Enter saves current description through the same form button', async ({ calendar: { page } }) => {
  await openEditor(page);
  await page.locator('#event-description-input').fill('Latest changes');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '1');
  await expect(page.locator('body')).toHaveAttribute('data-saved-description', 'Latest changes');
  await page.keyboard.press('Enter');
  await expect(page.locator('#event-description-input')).toHaveValue('Latest changes\n');
  await page.locator('#event-title-input').focus();
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '1');
});

test('Enter saves the full editor from fields other than the description', async ({ calendar: { page } }) => {
  await openEditor(page);
  await page.locator('#event-guest-input').evaluate(input => input.addEventListener('keydown', event => {
    if (event.key === 'Enter') event.preventDefault();
  }));
  await page.locator('#event-guest-input').focus();
  await page.keyboard.press('Enter');
  await page.locator('#event-description-input').focus();
  await page.keyboard.press('Enter');
  await page.locator('.modal-two-footer button[type="button"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '0');
  await page.locator('#event-location-input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '1');
  await page.locator('#event-title-input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '2');
});

test('save ignores disabled, busy, repeated and composing shortcuts', async ({ calendar: { page } }) => {
  await openEditor(page);
  const save = page.getByTestId('create-event-modal:save');
  await save.evaluate(button => { button.disabled = true; });
  await page.keyboard.press('Meta+Enter');
  await save.evaluate(button => { button.disabled = false; button.setAttribute('aria-busy', 'true'); });
  await page.keyboard.press('Meta+Enter');
  await save.evaluate(button => button.setAttribute('aria-busy', 'false'));
  for (const extra of [{ repeat: true }, { isComposing: true }]) {
    await page.locator('#event-description-input').dispatchEvent('keydown', { key: 'Enter', metaKey: true, ...extra });
  }
  await expect(page.locator('body')).toHaveAttribute('data-saves', '0');
});

test('E edits the visible card but does not hijack typing or modified keys', async ({ calendar: { page } }) => {
  await page.locator('.eventpopover').focus();
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
  await page.keyboard.press('Meta+e');
  await page.locator('#search').fill('');
  await page.keyboard.press('e');
  await expect(page.locator('#search')).toHaveValue('e');
  await page.evaluate(() => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.id = 'rich-editor';
    document.body.append(editor);
    editor.focus();
  });
  await page.keyboard.press('e');
  await expect(page.locator('#rich-editor')).toHaveText('e');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
});

test('E ignores hidden/busy cards and cards behind an open modal', async ({ calendar: { page } }) => {
  const edit = page.getByTestId('event-popover:edit');
  await edit.evaluate(button => button.setAttribute('aria-busy', 'true'));
  await page.keyboard.press('e');
  await edit.evaluate(button => button.setAttribute('aria-busy', 'false'));
  await page.locator('.eventpopover').evaluate(element => { element.hidden = true; });
  await page.keyboard.press('e');
  await page.locator('.eventpopover').evaluate(element => { element.hidden = false; });
  await openEditor(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '0');
});

test('settings persist, update the open calendar immediately, and reset', async ({ calendar: { page, id }, context }) => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await expect(settings.locator('#save')).toHaveText('Cmd + Enter');
  await settings.locator('#edit').click();
  await settings.keyboard.press('Alt+x');
  await expect(settings.locator('#status')).toHaveText('Saved');
  await settings.reload();
  await expect(settings.locator('#edit')).toHaveText('Alt + X');
  await page.bringToFront();
  await page.locator('.eventpopover').focus();
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '0');
  await page.keyboard.press('Alt+x');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
  await settings.bringToFront();
  await settings.locator('#save').click();
  await settings.keyboard.press('Control+Enter');
  await expect(settings.locator('#status')).toHaveText('Saved');
  await page.bringToFront();
  await openEditor(page);
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '0');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '1');
  await settings.bringToFront();
  await settings.getByRole('button', { name: 'Reset shortcuts' }).click();
  await expect(settings.locator('#save')).toHaveText('Cmd + Enter');
  await expect(settings.locator('#edit')).toHaveText('E');
});

test('shortcut capture cancels and prevents duplicate bindings', async ({ calendar: { id }, context }) => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.locator('#edit').click();
  await settings.keyboard.press('Meta+Enter');
  await expect(settings.locator('#status')).toHaveText('Already assigned');
  await settings.keyboard.press('Escape');
  await expect(settings.locator('#edit')).toHaveText('E');
});

test('settings follow light/dark mode without overflowing', async ({ calendar: { id }, context }, testInfo) => {
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 342, height: 480 });
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await expect(settings.locator('#save')).toHaveText('Cmd + Enter');
  for (const mode of ['light', 'dark']) {
    await settings.emulateMedia({ colorScheme: mode });
    expect(await settings.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe(mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 24, 37)');
    expect(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await settings.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath(`settings-${mode}.png`) });
  }
});

test('does not inject on other sites', async ({ page }) => {
  await page.goto('https://example.org/');
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(0);
  await expect(page.locator('.eventpopover-title a')).toHaveCount(0);
});

async function installDeletion(page, options = {}) {
  await page.evaluate(({ view = 'small', delay = 0, recurring = false, unrelated = false, noDelete = false }) => {
    document.body.dataset.deletes = '0';
    document.body.dataset.deleteClicks = '0';
    document.body.dataset.moreClicks = '0';
    const showConfirmation = () => {
      document.body.dataset.deleteClicks = String(Number(document.body.dataset.deleteClicks) + 1);
      setTimeout(() => {
        const dialog = document.createElement('form');
        dialog.className = 'modal-two-dialog-container';
        dialog.innerHTML = `<h1 class="modal-two-title">${unrelated ? 'Delete calendar' : recurring ? 'Delete recurring event' : 'Delete event'}</h1>
          ${recurring ? '<label><input type="radio" name="recurringType" checked>This event</label><label><input type="radio" name="recurringType">All events</label>' : ''}
          <button type="button" class="confirm-delete">Delete</button><button type="button">Cancel</button>`;
        dialog.querySelector('.confirm-delete').onclick = () => {
          document.body.dataset.deletes = String(Number(document.body.dataset.deletes) + 1);
          document.body.dataset.scope = dialog.querySelector('input:checked')?.parentElement.textContent || 'single';
          dialog.remove();
        };
        document.body.append(dialog);
      }, delay);
    };
    const full = () => {
      const fragment = document.querySelector('#editor').content.cloneNode(true);
      const form = fragment.querySelector('form');
      if (!noDelete) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Delete';
        button.onclick = showConfirmation;
        form.querySelector('.modal-two-footer').prepend(button);
      }
      document.body.append(fragment);
      form.querySelector('textarea').focus();
    };
    if (view === 'large') full();
    else if (view === 'medium') {
      document.querySelector('.eventpopover').remove();
      const card = document.createElement('div');
      card.className = 'eventpopover';
      card.tabIndex = -1;
      card.innerHTML = `<form class="form--icon-labels"><header class="eventpopover-header"></header>
        <input id="event-title-input" value="Example event"><textarea id="event-description-input"></textarea>
        <footer><button type="button" data-testid="create-event-popover:more-event-options">More options</button>
        <button type="submit" data-testid="create-event-popover:save">Save</button></footer></form>`;
      card.querySelector('[data-testid="create-event-popover:more-event-options"]').onclick = () => {
        document.body.dataset.moreClicks = String(Number(document.body.dataset.moreClicks) + 1);
        card.remove();
        setTimeout(full, delay);
      };
      document.body.append(card);
      card.querySelector('textarea').focus();
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.testid = 'event-popover:delete';
      button.textContent = 'Delete';
      button.onclick = showConfirmation;
      document.querySelector('.eventpopover-header').append(button);
      document.querySelector('.eventpopover').focus();
    }
  }, options);
}

for (const view of ['small', 'medium', 'large']) {
  test(`deletes and confirms from the ${view} event view`, async ({ calendar: { page } }) => {
    await installDeletion(page, { view, delay: 30 });
    await page.keyboard.press('Meta+Shift+r');
    await expect(page.locator('body')).toHaveAttribute('data-deletes', '1');
    await expect(page.locator('body')).toHaveAttribute('data-delete-clicks', '1');
    await expect(page.locator('body')).toHaveAttribute('data-more-clicks', view === 'medium' ? '1' : '0');
  });
}

test('save works in the medium editor too', async ({ calendar: { page } }) => {
  await installDeletion(page, { view: 'medium' });
  await page.locator('#event-description-input').fill('Compact changes');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '1');
  await expect(page.locator('body')).toHaveAttribute('data-saved-description', 'Compact changes');
});

test('deletion preserves the selected recurring-event scope', async ({ calendar: { page } }) => {
  await installDeletion(page, { recurring: true });
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '1');
  await expect(page.locator('body')).toHaveAttribute('data-scope', 'This event');
});

test('deletion never confirms unrelated dialogs', async ({ calendar: { page } }) => {
  await installDeletion(page, { unrelated: true });
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('.modal-two-title')).toHaveText('Delete calendar');
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '0');
  await expect(page.locator('body')).toHaveAttribute('data-delete-clicks', '1');
});

test('Escape cancels pending deletion and a new press can confirm explicitly', async ({ calendar: { page } }) => {
  await installDeletion(page, { delay: 200 });
  await page.keyboard.press('Meta+Shift+r');
  await page.keyboard.press('Escape');
  await expect(page.locator('.confirm-delete')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '0');
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '1');
});

test('busy deletion and missing editor Delete never fall through to another card', async ({ calendar: { page } }) => {
  await installDeletion(page);
  await page.getByTestId('event-popover:delete').evaluate(button => button.setAttribute('aria-busy', 'true'));
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('body')).toHaveAttribute('data-delete-clicks', '0');
  await page.getByTestId('event-popover:delete').evaluate(button => button.setAttribute('aria-busy', 'false'));
  await installDeletion(page, { view: 'large', noDelete: true });
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('body')).toHaveAttribute('data-delete-clicks', '0');
});

test('repeated delete shortcut triggers only one action', async ({ calendar: { page } }) => {
  await installDeletion(page, { delay: 150 });
  await page.keyboard.press('Meta+Shift+r');
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '1');
  await expect(page.locator('body')).toHaveAttribute('data-delete-clicks', '1');
});

test('all feature checkboxes apply immediately and persist', async ({ calendar: { page, id }, context }) => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await expect(settings.getByRole('checkbox')).toHaveCount(6);
  await settings.getByRole('checkbox', { name: 'Clickable links' }).uncheck();
  await expect(page.locator('.eventpopover-title a')).toHaveCount(0);
  await settings.getByRole('checkbox', { name: 'Copy buttons' }).uncheck();
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(0);
  for (const name of ['Save shortcut', 'Edit shortcut', 'Delete shortcut', 'Navigate shortcut']) {
    await settings.getByRole('checkbox', { name, exact: true }).uncheck();
  }
  await expect(settings.locator('#save')).toBeDisabled();
  await expect(settings.locator('#edit')).toBeDisabled();
  await expect(settings.locator('#delete')).toBeDisabled();
  await expect(settings.locator('#navigate')).toBeDisabled();
  await page.bringToFront();
  await page.locator('.eventpopover').focus();
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '0');
  await openEditor(page);
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-saves', '0');
  await page.reload();
  await expect(page.locator('.eventpopover')).toBeVisible();
  await expect(page.locator('.eventpopover-title a')).toHaveCount(0);
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(0);
  await settings.bringToFront();
  await settings.reload();
  for (const checkbox of await settings.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  await settings.getByRole('checkbox', { name: 'Clickable links' }).check();
  await expect(page.locator('.eventpopover-title a')).toHaveCount(2);
  await settings.getByRole('checkbox', { name: 'Copy buttons' }).check();
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(1);
});

test('delete shortcut is configurable, toggleable, and survives older saved settings', async ({ calendar: { page, id, evaluate }, context }) => {
  await evaluate(`chrome.storage.local.set({ shortcuts: { edit: ProtonCalentterShortcuts.defaults.edit, save: ProtonCalentterShortcuts.defaults.save } })`);
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await expect(settings.locator('#delete')).toHaveText('Cmd + Shift + R');
  await settings.locator('#delete').click();
  await settings.keyboard.press('Alt+d');
  await expect(settings.locator('#status')).toHaveText('Saved');
  await page.bringToFront();
  await installDeletion(page);
  await page.keyboard.press('Alt+d');
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '1');
  await settings.bringToFront();
  await settings.getByRole('checkbox', { name: 'Delete shortcut', exact: true }).uncheck();
  await expect(settings.locator('#delete')).toBeDisabled();
  await page.bringToFront();
  await page.keyboard.press('Alt+d');
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '1');
});

test('pending deletion stops when the feature is disabled', async ({ calendar: { page, evaluate } }) => {
  await installDeletion(page, { delay: 200 });
  await page.keyboard.press('Meta+Shift+r');
  await evaluate(`chrome.storage.local.set({ features: { delete: false } })`);
  await expect(page.locator('.confirm-delete')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '0');
});

test('pending deletion expires instead of confirming a late dialog', async ({ calendar: { page } }) => {
  await installDeletion(page, { delay: 3200 });
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('.confirm-delete')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-deletes', '0');
});

async function searchPreview(page, delayed = false) {
  await page.evaluate(delayed => {
    const card = document.querySelector('.eventpopover');
    const button = card.querySelector('[data-testid="event-popover:edit"]');
    button.dataset.testid = 'event-popover:open';
    button.textContent = 'Navigate to event';
    document.body.dataset.navigations = '0';
    window.finishNavigation = () => {
      const next = card.cloneNode(true);
      const edit = next.querySelector('[data-testid="event-popover:open"]');
      edit.dataset.testid = 'event-popover:edit';
      edit.textContent = 'Edit';
      card.replaceWith(next);
      next.focus();
    };
    button.onclick = () => {
      document.body.dataset.navigations = String(Number(document.body.dataset.navigations) + 1);
      if (!delayed) setTimeout(window.finishNavigation, 20);
    };
    card.focus();
  }, delayed);
}

test('E navigates from search and edits the resulting event once', async ({ calendar: { page } }) => {
  await searchPreview(page);
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveAttribute('data-navigations', '1');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
});

test('Enter navigates from search without editing', async ({ calendar: { page } }) => {
  await searchPreview(page);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('event-popover:edit')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-navigations', '1');
  await expect(page.locator('body')).toHaveAttribute('data-edits', '0');
});

test('search shortcuts respect typing, modifiers, busy buttons and dialogs', async ({ calendar: { page } }) => {
  await searchPreview(page, true);
  await page.keyboard.press('Meta+Enter');
  await page.locator('#search').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('e');
  await page.locator('.eventpopover').focus();
  await page.getByTestId('event-popover:open').evaluate(button => button.setAttribute('aria-busy', 'true'));
  await page.keyboard.press('e');
  await page.keyboard.press('Enter');
  await page.getByTestId('event-popover:open').evaluate(button => button.setAttribute('aria-busy', 'false'));
  await openEditor(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveAttribute('data-navigations', '0');
});

for (const interruption of ['Escape', 'pointer', 'disable', 'different event', 'timeout']) {
  test(`pending search edit cancels on ${interruption}`, async ({ calendar: { page, evaluate } }) => {
    await searchPreview(page, true);
    await page.keyboard.press('e');
    if (interruption === 'Escape') await page.keyboard.press('Escape');
    if (interruption === 'pointer') await page.locator('#search').click();
    if (interruption === 'disable') await evaluate('chrome.storage.local.set({ features: { edit: false } })');
    if (interruption === 'timeout') await page.waitForTimeout(8100);
    await page.evaluate(different => {
      window.finishNavigation();
      if (different) document.querySelector('.eventpopover-title').setAttribute('title', 'Another synthetic event');
    }, interruption === 'different event');
    await page.waitForTimeout(100);
    await expect(page.locator('body')).toHaveAttribute('data-edits', '0');
  });
}

test('navigation can be disabled and rebound', async ({ calendar: { page, evaluate } }) => {
  await searchPreview(page, true);
  await evaluate('chrome.storage.local.set({ features: { navigate: false } })');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-navigations', '0');
  await evaluate(`chrome.storage.local.set({ features: { navigate: true }, shortcuts: {
    navigate: { key: 'n', meta: false, ctrl: false, alt: true, shift: false }
  } })`);
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-navigations', '0');
  await page.keyboard.press('Alt+n');
  await expect(page.locator('body')).toHaveAttribute('data-navigations', '1');
});


test('search edit waits for a partially rendered event title', async ({ calendar: { page } }) => {
  await searchPreview(page, true);
  await page.keyboard.press('e');
  await page.evaluate(() => {
    window.finishNavigation();
    const title = document.querySelector('.eventpopover-title');
    const value = title.getAttribute('title');
    title.removeAttribute('title');
    title.textContent = '';
    setTimeout(() => { title.textContent = value; }, 250);
  });
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
});

test('search edit retries after a visibility animation without DOM changes', async ({ calendar: { page } }) => {
  await searchPreview(page, true);
  await page.keyboard.press('e');
  await page.evaluate(() => {
    window.finishNavigation();
    const style = document.createElement('style');
    style.textContent = `@keyframes reveal-edit {
      from { visibility: hidden; } to { visibility: visible; }
    }
    [data-testid="event-popover:edit"] { animation: reveal-edit 300ms step-end forwards; }`;
    document.head.append(style);
  });
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
});

test('search edit waits through navigation longer than three seconds', async ({ calendar: { page } }) => {
  await searchPreview(page, true);
  await page.keyboard.press('e');
  await page.evaluate(() => {
    const source = document.querySelector('.eventpopover');
    const next = source.cloneNode(true);
    next.querySelector('[data-testid="event-popover:open"]').dataset.testid = 'event-popover:edit';
    source.remove();
    setTimeout(() => { document.body.append(next); next.focus(); }, 3200);
  });
  await expect(page.locator('body')).toHaveAttribute('data-edits', '1');
});
