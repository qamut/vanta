# Contributing to VANTA

Thanks for helping. VANTA is small on purpose: one capsule, a handful of modules, everything local.

## Before you start

- **Bugs:** open an issue with your Windows version, what you did, what you expected and what happened. Logs help: *Settings → Privacy → Technical logs → Open*.
- **Features:** open an issue first and describe the problem you want to solve. A short discussion saves a long pull request.
- **Security issues:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Setup

Windows 10/11 x64, Node 22+, Rust stable (MSVC), WebView2.

```bash
npm ci
npm run ffmpeg:fetch
npm run desktop
```

## Pull requests

1. Branch from `main` and keep the change focused on one thing.
2. Run every check before pushing:
   ```bash
   npm run typecheck && npm run lint && npm test
   cd src-tauri && cargo clippy --all-targets && cargo test
   ```
3. Add or update tests when you change behavior.
4. UI text lives in `src/lib/locales/` (Portuguese and English): add both.
5. Describe what changed and how you tested it. Screenshots are welcome for UI changes.

## Ground rules

- Nothing leaves the user's computer unless the user asked for it. No telemetry, no analytics.
- The capsule never steals focus from the app the user is working in.
- Respect `prefers-reduced-motion` and keyboard access.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
