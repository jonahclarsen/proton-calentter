# Project instructions

- Always update README.md when making changes so it stays accurate.
- Always commit and push after making changes.
- Prefer pnpm over npm.
- Keep UI text minimal, match Proton Calendar's styling, and support system light/dark mode.
- Use SVG for button icons, never glyphs.
- Keep permissions narrow and never commit secrets, personal calendar data, browser profiles, or test artifacts.
- The loadable extension lives in extension/. No build step is required.
- Run pnpm test for behavior changes. Tests use synthetic Proton markup with an unpacked extension in Chromium.
- In the macOS Codex sandbox used for this project, Chromium launch is blocked. Run browser tests with approved execution outside the sandbox (`require_escalated`) from the start; keep `pnpm check` sandboxed. In unfamiliar environments, use `pnpm test --max-failures=1` to diagnose launch failures before running the full suite. A launch-time `Target page, context or browser has been closed` with `SIGABRT` and `kill EPERM` is a known sandbox failure: retry outside the sandbox, without weakening browser security or changing extension code. Only report tests as passing after a successful run.
- The compact editor has no Delete button: open More options, then use the full editor's Delete button. Keep multi-step deletion scoped to new event dialogs and cancel on user interruption.
- Keep personal Karabiner rules and backups outside this public repository.
