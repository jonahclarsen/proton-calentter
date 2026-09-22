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
  await settings.setViewportSize({ width: 342, height: 164 });
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await expect(settings.locator('#save')).toHaveText('Cmd + Enter');
  for (const mode of ['light', 'dark']) {
    await settings.emulateMedia({ colorScheme: mode });
    expect(await settings.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe(mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 24, 37)');
    expect(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath(`settings-${mode}.png`) });
  }
});

test('does not inject on other sites', async ({ page }) => {
  await page.goto('https://example.org/');
  await expect(page.locator('.pcal-copy-bar')).toHaveCount(0);
  await expect(page.locator('.eventpopover-title a')).toHaveCount(0);
});
