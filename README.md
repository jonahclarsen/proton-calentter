# Proton Calentter

Better Proton Calendar. A small Chrome extension for `calendar.proton.me`.

- Click web and app links in event titles and descriptions, including `plinth://playlist/`.
- Copy an event's title, description, or both from its preview card.
- Press **Cmd + Enter** in the description field to save.
- Press **Enter** in any other field of the full event editor, or with nothing focused, to save.
- Press **E** with an event card open to edit it, including previews opened from search.
- Press **Enter** in a search-result preview to navigate to the event.
- Press **Cmd + Shift + R** to delete and confirm from the preview card, compact editor, or full editor.
- After deleting from a preview card with the shortcut, press **Cmd + Z** or click **Undo** in the "Event deleted" notification to restore it.
- Enable or disable each feature using the checkboxes at the top of settings. All features start enabled.
- Change shortcuts from the extension's toolbar popup or extension options. Settings follow your system's light/dark mode; event buttons use Proton's own styling.

## Install

1. Download this repository using **Code → Download ZIP**, then unzip it (or clone it).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the **extension** folder inside this repository.
4. Disable the two original Tampermonkey scripts to avoid duplicate controls.
5. Refresh Proton Calendar. Pin **Proton Calentter** in Chrome's extensions menu for easy access to settings.

No build step or Tampermonkey installation is needed. After updating the files, click **Reload** on the extension in `chrome://extensions`, then refresh the calendar. The current version is **1.2.0**; verify that Chrome shows this version after reloading. Earlier search-shortcut updates also reported 1.1.0.

## Shortcuts

Click a shortcut in the popup, then press its replacement. Changes save automatically and apply to already-open calendar tabs. **Esc** cancels; the reset icon restores the defaults. On Windows/Linux, set the save shortcut to **Ctrl + Enter** if preferred. Chrome or your operating system may reserve some key combinations.

Save only runs while editing the event description, in either editor size. It clicks that form's Save button and preserves Proton's validation and recurring-event prompts. Edit ignores text inputs, open dialogs, hidden cards, and disabled or busy buttons. Holding a shortcut does not repeatedly trigger it. From a search preview, Edit navigates to the event and waits for the matching event card to finish loading and become editable, then clicks Edit automatically. It retries through delayed rendering, visibility animations, and ignored Edit clicks for up to eight seconds, stopping when the editor or a dialog opens. New keyboard or pointer input, leaving the tab, disabling Edit, or the timeout cancels the pending edit. Enter navigates without editing and preserves typing and focused controls; its shortcut and feature toggle are configurable.

In the full editor, plain **Enter** also saves from any field except the description (where it adds a new line), and when nothing is focused or selected. It skips focus elsewhere on the page, prompts open over the editor, buttons, links, dropdowns, and fields where Proton already handles Enter itself, such as guest suggestions. It follows the save feature toggle.

The delete shortcut clicks the event's Delete button and confirms the resulting event-deletion prompt, using Proton's currently selected scope (including its default recurring-event choice). From the compact editor, it opens **More options** first because that card has no Delete button. It also works while typing in an event editor with the default modified shortcut. It never searches other cards behind a dialog. New user input, leaving the tab, disabling deletion, or a three-second timeout cancels any pending steps. Delete recognition in editors and confirmations currently requires Proton's English labels. A disabled delete shortcut leaves the key combination to the browser, where Cmd + Shift + R normally reloads the page.

Proton has no event trash, so undo recreates the event through Proton's own **Duplicate** action, captured just before the shortcut deletes it, and saves the copy automatically. The restored event keeps its calendar, time, title, location, description, and notifications, but gets a new identity; video-conference links and, on free plans, event colors are not restored. Undo is offered only after Proton confirms the deletion, only for deletions started from a preview card, and never for recurring events, single occurrences, or events with participants (where a copy could re-send invitations). It stays available while the notification shows, for at least ten seconds and at most one minute. **Cmd + Z** (or **Ctrl + Z**) is ignored while typing or with a dialog open; any input before the copy saves leaves its editor open for you. Undo follows the delete feature toggle and relies on Proton's English "Event deleted" notification and its internal React handlers, so a Proton update may disable it until selectors are updated.

Disabling links or copy buttons removes the extension's additions from already-open cards immediately. Shortcut settings and feature toggles persist locally; resetting shortcuts leaves feature toggles unchanged. Disable any older Karabiner mapping for the same shortcut so the keys reach the extension.

Copy buttons read the current event at click time and preserve description line breaks. Description and combined-copy buttons are disabled when there is no description. Web links open in a new tab. App links using `scheme://` URLs open through the browser’s registered app handler; Chrome may ask you to confirm opening the app. Executable, local-file, and browser-internal URLs are not linked.

## Privacy

The extension runs only on `https://calendar.proton.me/*`. All processing is local. It makes no network requests, collects no analytics, and stores only your shortcut preferences and feature toggles locally. Undo never stores event data: it holds a reference to Proton's in-memory Duplicate action only until undo is used, expires, is disabled, or the deletion is interrupted, and a page reload discards it. It accesses displayed event text to add links and copy text when requested.

Permissions: `clipboardWrite` for copying and `storage` for shortcuts. A small script runs in the page itself (`undo.js`) only to reach Proton's Duplicate action for undo. It does not read your clipboard or request account credentials. There is no background service or external runtime dependency. Opening a link navigates to the URL or launches the registered app you clicked as usual.

## Development

```sh
pnpm install
pnpm exec playwright install chromium
pnpm check
pnpm test
```

The browser tests load the actual unpacked extension into Chromium and serve synthetic calendar markup locally through request interception. They cover linkification, copying, SPA updates, all three deletion views, confirmation scope and cancellation, undo via notification and Cmd + Z with its safeguards, feature toggles, keyboard safeguards, settings persistence, and both color schemes. Clipboard calls are stubbed inside the extension's isolated world so tests do not change your clipboard. No Proton login or personal event data is needed.

The macOS Codex sandbox used for this project blocks Chromium from launching; agents should run browser tests with approved execution outside that sandbox. A launch failure reporting `Target page, context or browser has been closed`, `SIGABRT`, and `kill EPERM` occurs before test assertions run. In unfamiliar environments, `pnpm test --max-failures=1` stops quickly for diagnosis. `pnpm check` works inside the sandbox.

`extension/` contains all installable files. `tests/` contains synthetic fixtures and browser tests. There is no local server or development port.

This is an unofficial extension, unaffiliated with Proton. It relies on Proton Calendar's page markup; a future Proton UI update may require selector changes. Automated tests validate representative markup, not a signed-in live account.

The toolbar icon uses Proton Calendar's favicon, bundled locally. The artwork belongs to Proton AG; see [icon provenance](extension/icons/README.md).
