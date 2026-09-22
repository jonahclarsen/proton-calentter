# Project instructions

- Always update README.md when making changes so it stays accurate.
- Always commit and push after making changes.
- Prefer pnpm over npm.
- Keep UI text minimal, match Proton Calendar's styling, and support system light/dark mode.
- Use SVG for button icons, never glyphs.
- Keep permissions narrow and never commit secrets, personal calendar data, browser profiles, or test artifacts.
- The loadable extension lives in extension/. No build step is required.
- Run pnpm test for behavior changes. Tests use synthetic Proton markup with an unpacked extension in Chromium.
- The compact editor has no Delete button: open More options, then use the full editor's Delete button. Keep multi-step deletion scoped to new event dialogs and cancel on user interruption.
- Keep personal Karabiner rules and backups outside this public repository.
