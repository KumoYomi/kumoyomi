# KumoYomi Privacy Policy

**Effective date:** November 18, 2026  
**Extension:** KumoYomi (Firefox Add-on ID: `kumoyomi@kumoyomi.app`)

---

## 1. Zero Data Collection (`data_collection_permissions: none`)

KumoYomi collects, transmits, logs, sells, or shares **zero personal data, telemetry, analytics, crash reports, or reading activity**.

KumoYomi has **no backend server** of its own. All features run 100% locally inside your browser.

---

## 2. Local Storage Only

All extension state is stored exclusively on your device using your browser's local storage (`IndexedDB` database `kumoyomi-db`, `storage.local` / `storage.session`, and `sessionStorage` / `localStorage`):

- User preferences (UI language, reader layout settings, notification preference, custom categories)
- Installed external JSON source repository manifests and source configurations
- Followed library series, chapter read states, reading history, and cached covers / offline downloaded chapters

You can inspect, export (`Settings → Export backup`), or permanently wipe this data at any time.

---

## 3. Network Connections

KumoYomi never sends requests to KumoYomi developers or third-party analytics providers.

Network requests are initiated **exclusively** toward:
1. External source repository URLs that **you explicitly add** in **Sources & Repos** (for example, GitHub raw repository URLs).
2. Website origins defined inside the JSON source configurations **you choose to enable or read**.

---

## 4. Browser Permissions Explained

- **`storage` & `unlimitedStorage`**: Persist your local library, settings, cached cover blobs, and downloaded offline chapters inside IndexedDB without premature browser quota eviction.
- **`alarms`**: Schedule periodic local background chapter update checks at the interval you choose in Settings.
- **`notifications`**: Display optional local browser notifications when background checks detect new unread chapters (can be disabled in Settings).
- **`declarativeNetRequest` & `declarativeNetRequestWithHostAccess`**: Set compliant `Referer` / `Origin` headers on extension-initiated fetches to enabled manga/CDN hosts so covers and chapter pages load without hotlink errors.
- **`tabs` & `scripting` (`tabHide` on Firefox)**: Open or focus the KumoYomi reader tab, assist with human challenge popups on sites you access, hide cleared background verification helper tabs cleanly from Firefox's tab strip so they do not clutter your open tabs, and read/fetch directly from a tab you already cleared in the browser when cookies are partitioned.
- **`host_permissions` / `optional_host_permissions`**: Required only to fetch series metadata and images from whichever arbitrary external source repositories and websites you choose to configure. On the Firefox AMO *Listed* build (`optional_host_permissions`), host access is requested strictly on user interaction.

---

## 5. Contact

If you have privacy questions or discover a security issue, open an issue in the public repository:  
https://github.com/KumoYomi/kumoyomi/issues
