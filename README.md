# Proton Calentter

Better Proton Calendar. A small Chrome extension for `calendar.proton.me`.

- Click links in event titles.
- Copy an event's title, description, or both from its preview card.
- Press **Cmd + Enter** in the description field to save.
- Press **Enter** in any other field of the full event editor to save.
- Press **E** with an event card open to edit it, including previews opened from search.
- Press **Enter** in a search-result preview to navigate to the event.
- Press **Cmd + Shift + R** to delete and confirm from the preview card, compact editor, or full editor.
- Enable or disable each feature using the checkboxes at the top of settings. All features start enabled.
- Change shortcuts from the extension's toolbar popup or extension options. Settings follow your system's light/dark mode; event buttons use Proton's own styling.

## Install

1. Download this repository using **Code → Download ZIP**, then unzip it (or clone it).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the **extension** folder inside this repository.
4. Disable the two original Tampermonkey scripts to avoid duplicate controls.
5. Refresh Proton Calendar. Pin **Proton Calentter** in Chrome's extensions menu for easy access to settings.

No build step or Tampermonkey installation is needed. After updating the files, click **Reload** on the extension in `chrome://extensions`, then refresh the calendar. The current version is **1.1.1**; verify that Chrome shows this version after reloading. Versions before this bump also showed 1.1.0 while the search-preview shortcuts were being updated.

## Shortcuts

Click a shortcut in the popup, then press its replacement. Changes save automatically and apply to already-open calendar tabs. **Esc** cancels; the reset icon restores the defaults. On Windows/Linux, set the save shortcut to **Ctrl + Enter** if preferred. Chrome or your operating system may reserve some key combinations.

Save only runs while editing the event description, in either editor size. It clicks that form's Save button and preserves Proton's validation and recurring-event prompts. Edit ignores text inputs, open dialogs, hidden cards, and disabled or busy buttons. Holding a shortcut does not repeatedly trigger it. From a search preview, Edit navigates to the event and waits for the matching event card to finish loading and become editable, then clicks Edit automatically. It retries through delayed rendering and visibility animations for up to eight seconds. New keyboard or pointer input, leaving the tab, disabling Edit, or the timeout cancels the pending edit. Enter navigates without editing and preserves typing and focused controls; its shortcut and feature toggle are configurable.

In the full editor, plain **Enter** also saves from any field except the description (where it adds a new line). It skips buttons, links, dropdowns, and fields where Proton already handles Enter itself, such as guest suggestions. It follows the save feature toggle.

The delete shortcut clicks the event's Delete button and confirms the resulting event-deletion prompt, using Proton's currently selected scope (including its default recurring-event choice). From the compact editor, it opens **More options** first because that card has no Delete button. It also works while typing in an event editor with the default modified shortcut. It never searches other cards behind a dialog. New user input, leaving the tab, disabling deletion, or a three-second timeout cancels any pending steps. Delete recognition in editors and confirmations currently requires Proton's English labels. A disabled delete shortcut leaves the key combination to the browser, where Cmd + Shift + R normally reloads the page.

Disabling links or copy buttons removes the extension's additions from already-open cards immediately. Shortcut settings and feature toggles persist locally; resetting shortcuts leaves feature toggles unchanged. Disable any older Karabiner mapping for the same shortcut so the keys reach the extension.

Copy buttons read the current event at click time and preserve description line breaks. Description and combined-copy buttons are disabled when there is no description. Links open in a new tab.

## Privacy

The extension runs only on `https://calendar.proton.me/*`. All processing is local. It makes no network requests, collects no analytics, and stores only your shortcut preferences and feature toggles locally. It accesses displayed event text to add links and copy text when requested.

Permissions: `clipboardWrite` for copying and `storage` for shortcuts. It does not read your clipboard or request account credentials. There is no background service or external runtime dependency. Opening a title link navigates to the URL you clicked as usual.

## Development

```sh
pnpm install
pnpm exec playwright install chromium
pnpm check
pnpm test
```

The browser tests load the actual unpacked extension into Chromium and serve synthetic calendar markup locally through request interception. They cover linkification, copying, SPA updates, all three deletion views, confirmation scope and cancellation, feature toggles, keyboard safeguards, settings persistence, and both color schemes. Clipboard calls are stubbed inside the extension's isolated world so tests do not change your clipboard. No Proton login or personal event data is needed.

`extension/` contains all installable files. `tests/` contains synthetic fixtures and browser tests. There is no local server or development port.

This is an unofficial extension, unaffiliated with Proton. It relies on Proton Calendar's page markup; a future Proton UI update may require selector changes. Automated tests validate representative markup, not a signed-in live account.

The toolbar icon uses Proton Calendar's favicon, bundled locally. The artwork belongs to Proton AG; see [icon provenance](extension/icons/README.md).
