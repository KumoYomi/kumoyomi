# KumoYomi Roadmap & Pending Improvements

This document tracks a complete, prioritized audit of everything remaining to polish KumoYomi, ready it for **Firefox Add-ons (AMO)** store publication, improve reliability/UX, and expand parser capabilities.

---

## Priority 1 — Firefox Runtime Verification & AMO Store Readiness

KumoYomi currently prioritizes **Firefox** before Chrome Web Store verification:

### 1. Firefox Live End-to-End Runtime Testing
Verify real desktop behavior on **Firefox (Release & Developer Edition)** across live edge cases:
- [ ] **`cfPopup.ts` window & docking flow**: Test `browser.windows.create({ type: 'popup' })`, automatic polling detection once clearance cookies succeed, and inter-window `tabs.move` into a background pinned tab (and fallback behavior if Firefox rejects cross-window docking between `popup` and `normal` windows).
- [ ] **`dnrRules.ts` on Firefox**: Confirm dynamic `modifyHeaders` rules using `initiatorDomains` match `moz-extension://<uuid>` cleanly on both main HTML fetches and anti-hotlink CDN image fetches.
- [ ] **`tabProxy.ts` in `world: 'MAIN'`**: Confirm fallback `fetch(..., { credentials: 'include' })` from cleared open tabs works across subdomains in Firefox's Multi-Account Containers / Total Cookie Protection partitions.

### 2. Firefox AMO Store Migration (`wxt.config.ts`)
Currently `wxt.config.ts` declares blanket `host_permissions: ['http://*/*', 'https://*/*']` and placeholder `gecko.id: 'kumoyomi@local.extension'`. Before *Listed* submission on [addons.mozilla.org](https://addons.mozilla.org/developers/):
- [ ] Replace blanket `host_permissions` with **`optional_host_permissions: ['http://*/*', 'https://*/*']`** (or dynamic origin grants).
- [ ] Trigger `browser.permissions.request({ origins: [...] })` automatically when a user adds a repository URL, enables a source (`baseUrl`), or encounters an image CDN subdomain (`*.rootdomain/*`).
- [ ] Register a permanent unique `browser_specific_settings.gecko.id` (matching the AMO listing) and keep `data_collection_permissions: { required: ['none'] }`.
- [ ] Publish a public Privacy Policy URL (required by AMO reviewers even when zero data leaves the device) and include exact reproducible build instructions (`pnpm install --frozen-lockfile && pnpm build:firefox`) alongside the source archive.

---

## Priority 2 — Core Engine & UX Reliability Gaps

- [ ] **Inline Script JSON Extraction (`<script>` Hydration)**: Support extracting structured objects/arrays embedded in `<script>` tags (e.g., `window.__NEXT_DATA__`, `__NUXT__`, or `ts_reader.run(...)`) directly from HTML responses in [`ParserEngine`](../src/core/parser/engine.ts).
- [ ] **Smart Auto-Deletion & Offline Hygiene**:
  - Clean up offline chapter blobs when a user removes a standalone/manual source (currently `removeRepository` cascades cleanup, whereas single-source removal leaves offline blobs behind until cleared manually).
  - Add an optional toggle in Settings: *"Automatically delete offline chapters once marked read"*.
- [ ] **Desktop Chapter Notifications**: `entrypoints/background.ts` triggers `kumoyomi-check-updates` on an alarm and updates the toolbar badge count, but does not yet raise optional `browser.notifications` alerts when new unread chapters arrive.
- [ ] **Per-Domain Pacing During Library Update Checks**: `checkLibraryUpdates()` ([`src/core/updater/updateChecker.ts`](../src/core/updater/updateChecker.ts)) iterates followed series sequentially; grouping and pacing consecutive checks per source hostname will significantly lower HTTP `429` / Cloudflare triggers.
- [ ] **Live Selector & Endpoint Tester inside `SourcesPage`**: Today the `Test` button checks only Popular p.1. Adding an interactive panel showing extracted fields for Catalogue, Manga Details, Chapters, and Pages would dramatically speed up community source authoring.
- [ ] **Automated Browser E2E Test Suite**: Add Playwright / web-ext smoke tests driving the built Firefox MV3 bundle against [`tools/mock-manga-servers.mjs`](../tools/mock-manga-servers.mjs) alongside the existing `vitest` unit suite.

---

## Priority 3 — Reader & Library Quality-of-Life Features

- [ ] **Custom Library Categories / Shelves**: Allow users to organize series into custom tags or tabs beyond fixed reading statuses.
- [ ] **Reader Keyboard Help Modal (`?`)**: Surface all navigation/zoom/fullscreen shortcuts in-app and add scroll-to-next-chapter transition triggers at chapter boundaries.
- [ ] **Local Backup Options**: Optionally allow filtering backup export/restore by category or viewing last backup timestamp reminder.
- [ ] **Reading Statistics & External Trackers**: Local reading stats (chapters read, time/streak) and optional opt-in OAuth sync to AniList / MyAnimeList / Kitsu.
- [ ] **Canvas Image Descrambling (Long-Term)**: Optional parameterized descrambling transforms for sources that slice/shuffle pages inside canvas buffers.

---

## Priority 4 — Cross-Browser Polish (Later)

- [ ] **Chrome / Chromium Re-Verification**: Once Firefox runtime tests, AMO permission UX, and UX polish are settled, perform full verification on Chrome / Brave / Edge against the `pnpm build` bundle and decide between local sideload distribution or Chrome Web Store compliance.
