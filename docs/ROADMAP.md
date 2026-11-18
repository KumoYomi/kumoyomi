# KumoYomi Roadmap & Status

This document tracks implemented capabilities in **`v0.4.0`** alongside remaining external publishing steps and long-term items.

---

## Priority 1 — Firefox Verification & AMO Store Readiness

### 1. Firefox Runtime & Cloudflare Session Fixes
- [x] **`dnrRules.ts` verified live on Firefox 160 MV3**: Verified end-to-end against `tools/mock-manga-servers.mjs` with strict HTTP `403` hotlink blocking enabled — MV3 `declarativeNetRequest` `Referer` injection loaded covers and Page 1 blob images cleanly (`760×1100`) with zero console errors.
- [x] **Interactive & offline flow verified live on Firefox 160 MV3**: Repository import, 3-stage **Inspect** debugger, Explore, Library custom categories, IndexedDB offline chapter download & playback, and Reader `?` shortcuts modal all verified in headless Firefox 160 (`kumoyomi@kumoyomi.app`).
- [x] **Cloudflare popup, tab-proxy & banner race hardened**:
  - `cfPopup.ts` always performs a pre-flight check (`tabProxy` + direct probe) before opening a popup window, preserves verified domains in 1 deduplicated pinned background tab instead of closing via direct-fetch false positives, strengthens EN/FR Turnstile detection, and removes empty popup shells cleanly after `tabs.move`.
  - `tabProxy.ts` automatically wakes sleeping/discarded pinned tabs (`browser.tabs.reload`) and retries transient `executeScript` errors while moving windows.
  - `browserBridge.ts` + `cfAutoVerify.ts` + `CloudflareBanner.tsx` share a live domain unlock event bus (`notifyCloudflareDomainUnlocked` / `onCloudflareDomainUnlocked`) and automatic stabilization retry so banners disappear and retry immediately once unlocked, and `ExplorePage` parallel search wraps requests in `runWithAutoCloudflarePopup`.
- [ ] **Real-world Turnstile / Cloudflare site spot-check**: User verification on live Cloudflare/Turnstile websites in a personal desktop Firefox profile (automated harnesses never solve CAPTCHAs).

### 2. Firefox AMO Store Readiness (`wxt.config.ts`)
- [x] **Optional host permissions build target (`build:firefox:amo`)**: `KUMOYOMI_AMO_LISTED=1` switches `wxt.config.ts` from blanket `host_permissions` to `optional_host_permissions: ['http://*/*', 'https://*/*']` (`kumoyomi-*-firefox-amo-listed.zip` built in CI).
- [x] **User-gesture synchronous permission grants**: `AppShell.tsx` global permission prompt and `SourcesPage.tsx` per-repo / per-source requests invoke `browser.permissions.request` synchronously before any `await`, requesting exact origin + `*.rootdomain/*` CDN wildcards.
- [x] **Production AMO metadata & Privacy Policy**: Updated `gecko.id` to `kumoyomi@kumoyomi.app` with `data_collection_permissions: { required: ['none'] }` and added [`PRIVACY.md`](../PRIVACY.md).
- [ ] **AMO Developer Hub manual submission**: Upload `kumoyomi-<version>-firefox-amo-listed.zip` + source zip + `pnpm install --frozen-lockfile && pnpm build:firefox:amo` build note + public `PRIVACY.md` link on [addons.mozilla.org](https://addons.mozilla.org/developers/).

---

## Priority 2 — Core Engine & UX Reliability

- [x] **Inline `<script>` JSON Extraction (`__NEXT_DATA__`, `ts_reader.run`)**: `request.scriptJson` (`selector` / `regex`) implemented in [`httpClient.ts`](../src/core/parser/httpClient.ts), tested in Vitest and integrated with `isSameSourceRequest` single-fetch cache reuse.
- [x] **Offline Hygiene & Auto-Deletion**: Added `removeSource()` cascade offline cleanup ([`repositoryService.ts`](../src/core/parser/repositoryService.ts)) plus `autoDeleteOfflineOnRead` setting wired into manual read marking and Reader chapter exit.
- [x] **Desktop Chapter Notifications**: Added `notifications` permission, localized `browser.notifications` alert on background updates in [`background.ts`](../entrypoints/background.ts) (opens `#/updates` on click), and Settings toggle.
- [x] **Per-Domain Pacing & CF Short-Circuit in `updateChecker.ts`**: [`checkLibraryUpdates()`](../src/core/updater/updateChecker.ts) round-robins across sources, paces consecutive same-host calls (`minHostIntervalMs: 650`), and short-circuits duplicate requests when a source returns `CloudflareChallengeError`.
- [x] **Interactive Source Inspector in `SourcesPage`**: Live 3-stage debugger (Catalogue/Search -> Details & Chapters -> Pages + live Page 1 anti-hotlink preview) with latency readout.
- [ ] **Automated CI Browser E2E Suite**: Wire a headless Playwright / BiDi smoke script into GitHub Actions (unit tests in `tests/parser.test.ts` currently run in CI).

---

## Priority 3 — Reader, Library & Backups

- [x] **Custom Library Categories**: Create/delete categories and filter series in [`LibraryPage`](../src/features/library/LibraryPage.tsx) and toggle category assignments in [`MangaDetailPage`](../src/features/manga-detail/MangaDetailPage.tsx).
- [x] **Reader Keyboard Help Modal (`?`)**: Press `?` / `H` or click `?` in the top bar for a modal listing all keyboard shortcuts and mouse click zones.
- [x] **Local Reading Statistics**: 4-card summary (followed series, chapters read, history entries, offline chapters) in [`UpdatesPage`](../src/features/updates/UpdatesPage.tsx).
- [ ] **External Trackers (AniList / MyAnimeList / Kitsu)**: Optional opt-in OAuth sync (future).
- [ ] **Canvas Image Descrambling (Long-Term)**: Optional parameterized descrambling transforms for canvas-shuffled pages.

---

## Priority 4 — Cross-Browser Polish (Later)

- [ ] **Chrome / Chromium Verification**: Re-verify Chromium MV3 bundle (`pnpm build`) across DevTools / Chrome Web Store requirements once Firefox AMO listing is published.
