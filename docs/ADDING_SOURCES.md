# Adding & Authoring KumoYomi Sources

KumoYomi parses websites using **declarative JSON configs** interpreted by [`ParserEngine`](../src/core/parser/engine.ts) and validated by [`validator.ts`](../src/core/parser/validator.ts).

To publish sources for everyone, submit Pull Requests to the separate community repository:
[**`KumoYomi-Sources/extensions-source`**](https://github.com/KumoYomi-Sources/extensions-source).

---

## 1. Repository Manifest & Source Layout

A source repository serves an `index.json` file matching `RepositoryManifest` ([`src/core/types/source.ts`](../src/core/types/source.ts)):

```json
{
  "name": "My Source Repository",
  "version": "1.0.0",
  "description": "Community JSON sources for KumoYomi",
  "templates": [
    "_templates/origines.json",
    "_templates/madara.json",
    "_templates/mangathemesia.json"
  ],
  "sources": [
    "sources/example-source.json"
  ]
}
```

When KumoYomi receives a GitHub repository URL (`https://github.com/owner/repo`), `repositoryService.ts` automatically resolves it to `raw.githubusercontent.com/<owner>/<repo>/main/index.json` (falling back to `master` if needed) and fetches each referenced relative `_templates/*.json` and `sources/*.json` path.

---

## 2. Which Sites Are Easy vs. Hard to Add?

Before writing a source, inspect the target site's Network panel and HTML response (`curl` or DevTools) to classify it:

### Easy — Standard Templates (`extends`)
WordPress and standard scan themes often need **only a small JSON file** extending one of `_templates/{origines,madara,mangathemesia}.json`:
```json
{
  "id": "example-fr",
  "name": "Example Scans",
  "lang": "fr",
  "baseUrl": "https://example.invalid",
  "extends": "madara",
  "popular": {
    "request": { "url": "{{baseUrl}}/manga/page/{{page}}/?m_orderby=views" }
  }
}
```

### Easy / Medium — Custom SSR HTML or Open REST JSON APIs
Supported directly by the built-in engine without writing TypeScript:
- Server-rendered HTML pages (`responseType: "html"` or omitted) with CSS selectors, regexes, and `replace` rules.
- REST JSON APIs (`responseType: "json"`) and AJAX HTML-inside-JSON (`responseType: "json-html"` with `jsonHtmlPath`).
- `GET` or `POST` requests with `queryParams`, `formBody`, `jsonBody`, and custom `headers`.
- Sequential / numbered CDN pages via `numberedPages` (supports padding, extension, URL suffix stripping, and dynamic token stripping via `stripTokensFromScript`).
- Sites needing an initial session cookie via `warmupUrl`, hotlink `Referer`/`Origin` headers (handled via DNR), or Cloudflare human verification (handled automatically via KumoYomi's popup + tab proxy).

### Hard / Currently Unsupported (Requires Core Engine Changes)
These patterns **cannot** be expressed in pure source JSON today:
1. **Dynamic client-side encryption / AES-encrypted API payloads** or per-request HMAC/timestamp signatures calculated in obfuscated JS.
2. **HTML canvas tile descrambling / image shuffling** (e.g., DRM slices reassembled onto `<canvas>`).
3. **Hydration blobs inside `<script>` tags (`window.__NEXT_DATA__`, `__NUXT__`, inline JS arrays)** when extracting multi-item arrays (catalogues, chapter lists, or page lists) if no clean JSON endpoint or HTML selector exists.
4. **Multi-step dynamic CSRF token logins / GraphQL persisted queries requiring runtime token scraping before each request**.

*(See [ROADMAP.md](ROADMAP.md) for upcoming engine enhancements like `__NEXT_DATA__` script-JSON extraction.)*

---

## 3. Source Schema Reference

Exact fields enforced by [`src/core/types/source.ts`](../src/core/types/source.ts) and [`interpolateTemplate`](../src/core/parser/httpClient.ts):

### Template Variables (`{{...}}`)
| Variable | Meaning |
| --- | --- |
| `{{baseUrl}}` | Source `baseUrl` without trailing `/` |
| `{{page}}` / `{{pageZero}}` | 1-based / 0-based page number |
| `{{query}}` / `{{encodedQuery}}` | Raw / URL-encoded search query |
| `{{mangaUrl}}` / `{{mangaUrlSlash}}` / `{{mangaSlug}}` | Selected manga URL, slash-normalized URL, or final path segment |
| `{{chapterUrl}}` / `{{chapterUrlSlash}}` / `{{chapterSlug}}` | Selected chapter URL, slash-normalized URL, or final path segment |
| `{{vars.<key>}}` | Custom per-source value from `source.vars.<key>` |

### `RequestConfig`
- `method`: `"GET"` (default) or `"POST"`
- `url`: Endpoint URL (supports template variables)
- `headers`: Key-value headers (templated)
- `queryParams`: Appended query parameters (`?k=v`, templated)
- `formBody`: `application/x-www-form-urlencoded` body (auto-encoded)
- `jsonBody`: `application/json` body (recursively templated)
- `responseType`: `"html"` (default), `"json"`, or `"json-html"`
- `jsonHtmlPath`: Dot path to HTML fragment when `responseType === "json-html"` (e.g., `"data.html"`)

### `FieldExtractor`
Used for both HTML DOM extraction and JSON extraction:
- HTML mode:
  - `selector`: CSS selector (or ordered fallback array of selectors)
  - `attr`: Attribute or fallback attribute array (`"text"`, `"ownText"`, `"html"`, `"href"`, `"data-src"`, `"data-lazy-src"`, `"src"`, etc.)
  - `labelMatch`: Matches label text (e.g. `["Author", "Auteur"]`) and reads `nextElementSibling`
  - `joinAll`: Concatenates all matched elements with separator (e.g. `", "` for genres/synopses)
- JSON mode:
  - `jsonPath`: Dot path (or fallback array of dot paths) relative to current object
  - `jsonTemplate`: String template combining JSON keys inside current object (e.g. `"Chapter {{num}} - {{title}}"`)
- Post-processing (both modes):
  - `regex`: Captures group 1 if present, else full match
  - `replace`: Array of `{ "pattern": "...", "replacement": "...", "flags": "g" }`
  - `prefix` / `suffix`: Prepended/appended if non-empty (supports `{{baseUrl}}`)
  - `decodeHtmlEntities`: Decodes HTML entities (`&amp;`, `&#039;`, etc.)
  - `absoluteUrl`: Resolves relative URL against `baseUrl` / current document URL
  - `trim`: Enabled (`true`) by default

### Endpoints Required per Source
1. **Catalogues (`popular`, `latest`, `search`)**: At least one recommended. Requires `request`, `itemSelector` (HTML) or `itemsPath` (JSON), and `fields` (`title`, `url`, optional `cover`, `latestChapter`). Pagination supports `hasNextPageSelector`, `hasNextPageJsonPath`, or `hasNextPageCalc` (`totalPath`, `limitPath`/`pageSize`, `pagePath`).
2. **Series Details (`mangaDetails`)**: Requires `request` and `fields` (`title` required; optional `cover`, `author`, `artist`, `description`, `status`, `genres`, `altTitles`), plus optional `statusMap`.
3. **Chapter List (`chapters`)**: Either fetches its own `request` or sets `"fallbackInline": true` to reuse `mangaDetails` HTML when the chapter AJAX/request endpoint fails or returns empty. `fields`: `title` & `url` required; optional `date`, `chapterNumber`. Set `"reverseOrder": true` if source lists oldest chapters first.
4. **Chapter Pages (`pages`)**: Requires `request` + either:
   - HTML selectors (`itemSelector` + `imageUrl`), OR
   - JSON array (`itemsPath` + `imageUrl`), OR
   - `numberedPages` (`countJsonPath`, `baseUrlJsonPath`, `padStart`, `extension`, `stripSuffixes`, `stripTokensFromScript`).

---

## 4. Testing Your Source Locally

1. Open KumoYomi → **Sources & Repos** → **Import JSON (.json)** or **Paste JSON**.
   - Note: if your source uses `"extends": "<template>"`, import the template `_templates/<template>.json` first (or test inside a self-contained `index.json`).
2. Click **Test** on your source card to verify Popular p.1 extraction.
3. Click **Explore** → search a title → open a manga detail page → verify cover loading, status, genres, chapter order, dates, and actual page rendering inside the reader.
4. *(When contributing to `KumoYomi-Sources/extensions-source`)* run:
   ```bash
   node scripts/validate-and-build.mjs --check
   ```

---

## 5. AI-Assisted Source Authoring

If you are using an AI coding agent (Antigravity, Claude Code, Codex, Cursor, etc.) to add a new source, paste the prompt below and supply the target website URL:

````markdown
Task: Add a new KumoYomi JSON source configuration for `<SITE_URL>` and prepare a PR for `KumoYomi-Sources/extensions-source`.

Instructions:
1. Read `KumoYomi/docs/ADDING_SOURCES.md` and `KumoYomi/src/core/types/source.ts` (or inspect `_templates/*.json` in `extensions-source`) to understand KumoYomi's exact JSON schema (`extends`, `RequestConfig`, `FieldExtractor`, `numberedPages`, `warmupUrl`).
2. Inspect `<SITE_URL>` (catalogue/popular/latest/search, manga detail HTML/JSON, chapter list HTML/AJAX/JSON, chapter page image URLs, and image Referer/CDN requirements):
   - First check whether it matches an existing `_templates/` theme (`origines`, `madara`, `mangathemesia`). If so, use `"extends"` and override only what differs.
   - Check feasibility first: if the site relies on obfuscated JS payload encryption, canvas tile descrambling, or mandatory multi-step logins/hydrations unsupported by `source.ts`, clearly explain why instead of writing broken config.
3. Create `sources/<site-id>.json` with clean selectors/JSON paths (`decodeHtmlEntities`, `absoluteUrl`, fallback `attr` arrays like `["data-src", "src"]` for lazy-loaded images, `statusMap`, etc.).
4. Register the new file in `index.json` (or run `node scripts/validate-and-build.mjs` in `KumoYomi-Sources/extensions-source` with `--check`).
5. Validate locally by pasting/importing the config into KumoYomi (Firefox) and testing: Search, Popular/Latest, Cover loading, Details, Chapters, and Chapter reading.
6. Commit only the new/updated JSON config (never copyrighted assets) and open a Pull Request on `KumoYomi-Sources/extensions-source`.
````

---

## 6. Converting Existing Mihon / Keiyoushi Theme Extensions

For sites matching `origines`, `madara`, or `mangathemesia`, KumoYomi includes a small helper converter in [`tools/mihon-converter/convert.mjs`](../tools/mihon-converter/convert.mjs):

```bash
pnpm convert:mihon -- --input /path/to/keiyoushi-extension-dir --out ./output-source.json
```

Always inspect and verify every selector in the generated JSON before opening a PR on `KumoYomi-Sources/extensions-source`.
