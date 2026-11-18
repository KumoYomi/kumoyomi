# Contributing to KumoYomi

Thank you for contributing to **KumoYomi**! Before opening a Pull Request, please check whether your contribution belongs in this repository or the external source repository:

| What you want to change | Target repository |
| --- | --- |
| Reader UI, library features, parser engine, i18n (`en`, `fr`, `es`, `zh`), extension APIs, tests | **`KumoYomi/kumoyomi`** (this repo) |
| Adding, fixing, or removing a specific manga website JSON config or `_templates/*.json` | [**`KumoYomi-Sources/extensions-source`**](https://github.com/KumoYomi-Sources/extensions-source) |

> **Neutral-shell policy:** Never commit real third-party scan/manga website URLs, copyrighted series titles, or scraped artwork into `KumoYomi/kumoyomi`. Use `tools/mock-manga-servers.mjs` and synthetic fixtures under `tests/fixtures/` when testing parser behavior.

---

## Development Setup

1. Clone the repository and install dependencies (`Node.js >= 22`, `pnpm`):
   ```bash
   pnpm install
   ```
2. Run type-checking and tests:
   ```bash
   pnpm typecheck
   pnpm test
   ```
3. Develop or preview:
   - **Firefox hot-reload**: `pnpm dev:firefox`
   - **Firefox production build**: `pnpm build:firefox` (load `.output/firefox-mv3/manifest.json` in `about:debugging#/runtime/this-firefox`)
   - **Chrome / Chromium build**: `pnpm build` (load `.output/chrome-mv3` in `chrome://extensions`)
   - **Standalone web UI preview (UI/layout work)**:
     ```bash
     node tools/mock-manga-servers.mjs --no-hotlink
     pnpm preview:web
     ```
     Then add `http://127.0.0.1:4179/repo/index.json` inside **Sources & Repos**.

---

## Codebase & Hierarchy Guidelines

Keep responsibilities cleanly separated along the existing architecture:

- **`src/core/`**: Zero React/DOM component coupling (`parser/`, `db/`, `offline/`, `image-loader/`, `extension/`, `updater/`, `i18n/`).
- **`src/features/<screen>/`**: Page-level React views tied to routes in `src/app/router.ts`.
- **`src/components/`**: Shared reusable visual primitives.
- **`src/core/i18n/`**: All user-facing UI strings **must** use `useTranslation()` and define matching keys across all four dictionaries (`locales/en.ts`, `locales/fr.ts`, `locales/es.ts`, `locales/zh.ts`). `src/core/i18n/types.ts` enforces completeness at compile time via `pnpm typecheck`.
- **Internal core error messages & code comments**: Write all new comments, JSDoc, and thrown `Error` messages in clear English (UI errors should still map cleanly or display readable messages).

---

## Reproducible Firefox AMO Build Verification

Whenever you modify `wxt.config.ts`, `package.json`, build config, or bundled assets, verify that both builds succeed cleanly as tested in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:firefox
pnpm build
```

---

## Pull Request Checklist

- [ ] Code is clean, well-typed, and free of third-party site references in `src/`, `tests/`, or docs.
- [ ] Any UI text changes are added to all 4 locales (`en`, `fr`, `es`, `zh`) and checked with `pnpm typecheck`.
- [ ] `pnpm test` passes with all tests green (`vitest run`).
- [ ] `pnpm build:firefox` (and `pnpm build`) complete without errors.
- [ ] Pull request describes what changed, why, and how it was tested (Firefox version noted if runtime-tested).
