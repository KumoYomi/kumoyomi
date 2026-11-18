import { db, hashStableId } from '@/src/core/db/db';
import {
  BUILT_IN_KEIYOUSHI_TEMPLATES,
  buildThemeSourceConfig,
  compileFrenchKotlinSource,
  INCOMPATIBLE_THEME_REASON_MAP,
  type KeiyoushiCompatReason,
  type KeiyoushiSourceMetadata,
  SUPPORTED_THEME_IDS,
  FRENCH_CUSTOM_RECIPES,
} from '@/src/core/parser/keiyoushiThemes';
import { syncAllSourceRulesToBackground } from '@/src/core/parser/repositoryService';
import {
  resolveSourceWithTemplates,
  validateRawSourceConfig,
} from '@/src/core/parser/validator';
import type {
  InstalledSourceRecord,
  RepositoryRecord,
  TemplateRecord,
} from '@/src/core/types/manga';
import type {
  RawSourceConfig,
  SourceTemplateConfig,
} from '@/src/core/types/source';

export const KEIYOUSHI_DEFAULT_REPO_URL =
  'https://github.com/keiyoushi/extensions-source';

export interface KeiyoushiRepoTarget {
  owner: string;
  repo: string;
  branch?: string;
  langPath: string;
  langCode: string;
  canonicalRepoUrl: string;
  repoId: string;
}

export interface KeiyoushiCatalogEntry {
  slug: string;
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  nsfw: boolean;
  theme?: string;
  compatible: boolean;
  compatReason: KeiyoushiCompatReason;
  alreadyInstalled: boolean;
}

export interface KeiyoushiCatalogScanResult {
  target: KeiyoushiRepoTarget;
  branch: string;
  repoDisplayName: string;
  entries: KeiyoushiCatalogEntry[];
  compatibleCount: number;
}

export interface KeiyoushiImportResult {
  repo: RepositoryRecord;
  installedCount: number;
  skipped: Array<{ name: string; reason: KeiyoushiCompatReason | string }>;
}

interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url?: string | null;
}

function slugifyId(name: string, lang: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const clean = base || 'source';
  return lang && !clean.endsWith(`-${lang}`) ? `${clean}-${lang}` : clean;
}

/**
 * Détecte si l'URL fournie pointe vers un dépôt GitHub de sources Keiyoushi/Tachiyomi.
 * Ne capture pas les dépôts JSON KumoYomi standards (qui pointent vers un `.json` ou un index).
 */
export function parseKeiyoushiRepoUrl(
  rawInput: string,
  langOverride?: string,
): KeiyoushiRepoTarget | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const owner = segments[0];
  const rawRepo = segments[1];
  if (!owner || !rawRepo) return null;

  const repo = rawRepo.replace(/\.git$/i, '');
  const joinedLower = parsed.pathname.toLowerCase();

  // Évite d'intercepter un lien direct vers un manifeste JSON hébergé sur GitHub
  if (joinedLower.endsWith('.json')) return null;

  const looksLikeKeiyoushi =
    owner.toLowerCase() === 'keiyoushi' ||
    /extensions?-source|tachiyomi|mihon/i.test(repo) ||
    /\/src\/[a-z-]+/i.test(joinedLower);

  if (!looksLikeKeiyoushi) return null;

  let branch: string | undefined;
  let langPath = 'src/fr';

  if (segments[2] === 'tree' && segments.length >= 4) {
    branch = segments[3];
    const sub = segments.slice(4).join('/');
    if (sub && /^src\/[a-z-]+$/i.test(sub)) {
      langPath = sub.toLowerCase();
    }
  }

  if (langOverride && /^[a-z-]+$/i.test(langOverride.trim())) {
    langPath = `src/${langOverride.trim().toLowerCase()}`;
  }

  const langCode = langPath.replace(/^src\//i, '') || 'fr';
  const canonicalRepoUrl = `https://github.com/${owner}/${repo}/tree/${branch ?? 'main'}/${langPath}`;
  const repoId = `repo_kei_${hashStableId(`${owner}/${repo}:${langPath}`.toLowerCase())}`;

  return {
    owner,
    repo,
    branch,
    langPath,
    langCode,
    canonicalRepoUrl,
    repoId,
  };
}

function extractFirstMatch(text: string, regex: RegExp): string | undefined {
  const m = regex.exec(text);
  return m?.[1]?.trim();
}

/**
 * Parse un fichier `build.gradle.kts` ou `build.gradle` d'une extension Keiyoushi
 * (format moderne DSL `keiyoushi { source { ... } }` ou format historique `extName`/`extClass`).
 */
export function parseKeiyoushiGradleBuild(
  gradleText: string,
  slug: string,
  targetLang = 'fr',
): KeiyoushiSourceMetadata | null {
  const theme =
    extractFirstMatch(gradleText, /\btheme\s*=\s*["']([^"']+)["']/) ??
    extractFirstMatch(gradleText, /\bthemePkg\s*=\s*["']([^"']+)["']/) ??
    extractFirstMatch(gradleText, /\bthemeClass\s*=\s*["']([^"']+)["']/);

  const normalizedTheme = theme?.toLowerCase().replace(/^madaranoajax$/, 'madara');

  const nsfw =
    /ContentWarning\.NSFW|\bisNsfw\s*=\s*true\b/i.test(gradleText) || false;

  // Format multi-sources moderne (`source { lang = "fr"; baseUrl = "https://..." }`)
  const sourceBlocks: Array<{ name?: string; lang?: string; baseUrl?: string }> = [];
  const sourceBlockRe = /\bsource\s*\{([\s\S]*?)\}/g;
  for (const m of gradleText.matchAll(sourceBlockRe)) {
    const body = m[1] ?? '';
    if (!body) continue;
    sourceBlocks.push({
      name: extractFirstMatch(body, /\bname\s*=\s*["']([^"']+)["']/),
      lang: extractFirstMatch(body, /\blang\s*=\s*["']([^"']+)["']/),
      baseUrl: extractFirstMatch(body, /\bbaseUrl\s*=\s*["']([^"']+)["']/),
    });
  }

  const preferredBlock =
    sourceBlocks.find((b) => b.lang?.toLowerCase() === targetLang) ??
    sourceBlocks[0];

  // Exclut les propriétés globales hors bloc `source { ... }` pour trouver le nom global si présent
  const strippedBlocks = gradleText.replace(sourceBlockRe, '');
  const name =
    preferredBlock?.name ??
    extractFirstMatch(strippedBlocks, /\bname\s*=\s*["']([^"']+)["']/) ??
    extractFirstMatch(gradleText, /\bextName\s*=\s*["']([^"']+)["']/) ??
    slug;

  const lang =
    preferredBlock?.lang ??
    extractFirstMatch(strippedBlocks, /\blang\s*=\s*["']([^"']+)["']/) ??
    extractFirstMatch(gradleText, /\bextLang\s*=\s*["']([^"']+)["']/) ??
    (targetLang === 'all' && /listOf\([^)]*["']fr["']/.test(gradleText)
      ? 'fr'
      : targetLang);

  const baseUrlRaw =
    preferredBlock?.baseUrl ??
    extractFirstMatch(strippedBlocks, /\bbaseUrl\s*=\s*["']([^"']+)["']/) ??
    extractFirstMatch(gradleText, /\bbaseUrl\s*=\s*["']([^"']+)["']/);

  if (!baseUrlRaw) return null;

  let cleanBaseUrl: string;
  try {
    const parsed = new URL(baseUrlRaw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    cleanBaseUrl = parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }

  return {
    slug,
    id: slugifyId(name, lang),
    name,
    lang,
    baseUrl: cleanBaseUrl,
    ...(nsfw ? { nsfw: true } : {}),
    ...(normalizedTheme ? { theme: normalizedTheme } : {}),
  };
}

function classifyStaticCompatibility(
  meta: KeiyoushiSourceMetadata,
): { compatible: boolean; compatReason: KeiyoushiCompatReason } {
  if (meta.theme) {
    if (SUPPORTED_THEME_IDS.has(meta.theme)) {
      return { compatible: true, compatReason: 'supported_theme' };
    }
    const mappedIncompatible = INCOMPATIBLE_THEME_REASON_MAP[meta.theme];
    return {
      compatible: false,
      compatReason: mappedIncompatible ?? 'incompatible_custom',
    };
  }

  if (FRENCH_CUSTOM_RECIPES[meta.slug]) {
    return { compatible: true, compatReason: 'supported_recipe' };
  }

  return { compatible: false, compatReason: 'incompatible_custom' };
}

async function fetchJsonGitHub<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        `GitHub API rate limit or access denied (HTTP 403) while reading ${url}.`,
      );
    }
    throw new Error(`GitHub API HTTP ${res.status} (${url})`);
  }
  return (await res.json()) as T;
}

async function fetchTextRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function resolveGitHubBranch(target: KeiyoushiRepoTarget): Promise<string> {
  if (target.branch) return target.branch;
  try {
    const info = await fetchJsonGitHub<{ default_branch?: string }>(
      `https://api.github.com/repos/${target.owner}/${target.repo}`,
    );
    if (info.default_branch?.trim()) {
      return info.default_branch.trim();
    }
  } catch {
    // Repli sur "main" si l'endpoint méta est limité ou indisponible
  }
  return 'main';
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item !== undefined) {
        results[idx] = await worker(item, idx);
      }
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

/**
 * Récupère la liste des extensions d'un dossier langue (`src/fr`, `src/en`, `src/all`, etc.) d'un dépôt Keiyoushi.
 */
export async function scanKeiyoushiCatalog(
  rawUrl: string,
  onProgress?: (done: number, total: number) => void,
  langOverride?: string,
): Promise<KeiyoushiCatalogScanResult> {
  const parsed = parseKeiyoushiRepoUrl(rawUrl, langOverride);
  if (!parsed) {
    throw new Error('URL GitHub Keiyoushi invalide.');
  }

  const branch = await resolveGitHubBranch(parsed);
  const contentsUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.langPath}?ref=${encodeURIComponent(branch)}`;
  const items = await fetchJsonGitHub<GitHubContentItem[]>(contentsUrl);

  const dirs = items
    .filter((item) => item.type === 'dir' && !item.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const existingSources = await db.sources.toArray();
  const existingIds = new Set(existingSources.map((s) => s.id));
  const existingBaseUrls = new Set(
    existingSources.map((s) => s.baseUrl.replace(/\/+$/, '').toLowerCase()),
  );

  let doneCount = 0;
  onProgress?.(0, dirs.length);

  const rawResults = await runWithConcurrency(dirs, 12, async (dir) => {
    const ktsUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(branch)}/${parsed.langPath}/${encodeURIComponent(dir.name)}/build.gradle.kts`;
    let gradleText = await fetchTextRaw(ktsUrl);
    if (!gradleText) {
      const groovyUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(branch)}/${parsed.langPath}/${encodeURIComponent(dir.name)}/build.gradle`;
      gradleText = await fetchTextRaw(groovyUrl);
    }

    doneCount += 1;
    onProgress?.(doneCount, dirs.length);

    if (!gradleText) return null;
    const meta = parseKeiyoushiGradleBuild(gradleText, dir.name, parsed.langCode);
    if (!meta) return null;

    const compat = classifyStaticCompatibility(meta);
    const alreadyInstalled =
      existingIds.has(meta.id) ||
      existingBaseUrls.has(meta.baseUrl.replace(/\/+$/, '').toLowerCase());

    const entry: KeiyoushiCatalogEntry = {
      slug: meta.slug,
      id: meta.id,
      name: meta.name,
      lang: meta.lang,
      baseUrl: meta.baseUrl,
      nsfw: Boolean(meta.nsfw),
      theme: meta.theme,
      compatible: compat.compatible,
      compatReason: compat.compatReason,
      alreadyInstalled,
    };
    return entry;
  });

  const entries = rawResults.filter((e): e is KeiyoushiCatalogEntry => e !== null);
  entries.sort((a, b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });

  const target: KeiyoushiRepoTarget = {
    ...parsed,
    branch,
    canonicalRepoUrl: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${branch}/${parsed.langPath}`,
  };

  return {
    target,
    branch,
    repoDisplayName: `Keiyoushi ${parsed.langCode.toUpperCase()} (${parsed.owner}/${parsed.repo})`,
    entries,
    compatibleCount: entries.filter((e) => e.compatible).length,
  };
}

export const scanKeiyoushiFrCatalog = scanKeiyoushiCatalog;

/**
 * Télécharge les fichiers `.kt` d'une extension Keiyoushi sélectionnée afin d'en extraire
 * ses surcharges de sélecteurs/variables (ex: mangaPath, archiveSelector, cdnHost, salts).
 */
async function fetchKotlinFilesForExtension(
  target: KeiyoushiRepoTarget,
  branch: string,
  slug: string,
): Promise<string> {
  const pkgPath = `${target.langPath}/${slug}/src/eu/kanade/tachiyomi/extension/${target.langCode}/${slug}`;
  const apiBase = `https://api.github.com/repos/${target.owner}/${target.repo}/contents`;

  const tryFetchDir = async (dirPath: string): Promise<GitHubContentItem[] | null> => {
    try {
      return await fetchJsonGitHub<GitHubContentItem[]>(
        `${apiBase}/${dirPath}?ref=${encodeURIComponent(branch)}`,
      );
    } catch {
      return null;
    }
  };

  let items = await tryFetchDir(pkgPath);
  if (!items) {
    // Repli récursif léger si le package Kotlin n'utilise pas exactement le slug du dossier
    const queue = [`${target.langPath}/${slug}/src`];
    items = [];
    for (let depth = 0; depth < 8 && queue.length > 0; depth += 1) {
      const current = queue.shift()!;
      const listed = await tryFetchDir(current);
      if (!listed) continue;
      for (const item of listed) {
        if (item.type === 'file' && item.name.endsWith('.kt')) {
          items.push(item);
        } else if (item.type === 'dir') {
          queue.push(item.path);
        }
      }
      if (items.length > 0 && queue.length === 0) break;
    }
  }

  const ktItems = (items ?? []).filter((i) => i.type === 'file' && i.name.endsWith('.kt'));
  if (ktItems.length === 0) return '';

  const texts = await Promise.all(
    ktItems.slice(0, 4).map(async (item) => {
      const rawUrl =
        item.download_url ??
        `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${encodeURIComponent(branch)}/${item.path}`;
      return (await fetchTextRaw(rawUrl)) ?? '';
    }),
  );
  return texts.join('\n');
}

/**
 * Convertit et installe dans KumoYomi uniquement les extensions cochées par l'utilisateur.
 */
export async function importSelectedKeiyoushiSources(
  scan: KeiyoushiCatalogScanResult,
  selectedSlugs: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<KeiyoushiImportResult> {
  const chosenSet = new Set(selectedSlugs);
  const chosenEntries = scan.entries.filter((e) => chosenSet.has(e.slug));
  if (chosenEntries.length === 0) {
    throw new Error('Aucune extension sélectionnée.');
  }

  const existingTemplates = await db.templates.toArray();
  const templateMap = new Map<string, SourceTemplateConfig>();
  for (const t of existingTemplates) {
    templateMap.set(t.id, t.config);
  }
  for (const [id, tpl] of Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES)) {
    templateMap.set(id, tpl);
  }

  const existingSources = await db.sources.toArray();
  const existingEnabledById = new Map(existingSources.map((s) => [s.id, s.enabled]));

  const now = Date.now();
  const templatesToSave = new Map<string, TemplateRecord>();
  const resolvedRecords: InstalledSourceRecord[] = [];
  const skipped: Array<{ name: string; reason: KeiyoushiCompatReason | string }> = [];

  let doneCount = 0;
  onProgress?.(0, chosenEntries.length);

  await runWithConcurrency(chosenEntries, 5, async (entry) => {
    try {
      const meta: KeiyoushiSourceMetadata = {
        slug: entry.slug,
        id: entry.id,
        name: entry.name,
        lang: entry.lang,
        baseUrl: entry.baseUrl,
        nsfw: entry.nsfw,
        theme: entry.theme,
      };

      let rawConfig: RawSourceConfig | undefined;

      if (entry.theme && SUPPORTED_THEME_IDS.has(entry.theme)) {
        const ktContent = await fetchKotlinFilesForExtension(
          scan.target,
          scan.branch,
          entry.slug,
        );
        rawConfig = buildThemeSourceConfig(meta, entry.theme, ktContent);
        const tpl = BUILT_IN_KEIYOUSHI_TEMPLATES[entry.theme];
        if (tpl) {
          templatesToSave.set(tpl.id, {
            id: tpl.id,
            repoId: scan.target.repoId,
            config: tpl,
            updatedAt: now,
          });
        }
      } else if (!entry.theme) {
        const needsKtFetch =
          entry.slug === 'mangamoins' ||
          entry.slug === 'scanhentaimenu' ||
          !FRENCH_CUSTOM_RECIPES[entry.slug];
        const ktContent = needsKtFetch
          ? await fetchKotlinFilesForExtension(scan.target, scan.branch, entry.slug)
          : '';
        const compiled = compileFrenchKotlinSource(meta, ktContent);
        if (!compiled.compatible || !compiled.config) {
          skipped.push({ name: entry.name, reason: compiled.reason });
          return;
        }
        rawConfig = compiled.config;
      } else {
        skipped.push({ name: entry.name, reason: entry.compatReason });
        return;
      }

      const validatedRaw = validateRawSourceConfig(rawConfig);
      const resolved = resolveSourceWithTemplates(validatedRaw, templateMap);

      resolvedRecords.push({
        id: resolved.id,
        repoId: scan.target.repoId,
        name: resolved.name,
        lang: resolved.lang,
        baseUrl: resolved.baseUrl,
        enabled: existingEnabledById.get(resolved.id) ?? true,
        extendsId: resolved.extends,
        rawConfig: validatedRaw,
        resolvedConfig: resolved,
        updatedAt: now,
      });
    } catch (err) {
      skipped.push({
        name: entry.name,
        reason: err instanceof Error ? err.message : 'Conversion failed',
      });
    } finally {
      doneCount += 1;
      onProgress?.(doneCount, chosenEntries.length);
    }
  });

  const existingForRepo = existingSources.filter((s) => s.repoId === scan.target.repoId);
  const unionIds = new Set(existingForRepo.map((s) => s.id));
  for (const r of resolvedRecords) unionIds.add(r.id);

  const repoRecord: RepositoryRecord = {
    id: scan.target.repoId,
    name: scan.repoDisplayName,
    url: scan.target.canonicalRepoUrl,
    description: `Mihon / Keiyoushi ${scan.target.langCode.toUpperCase()} (${unionIds.size})`,
    version: scan.branch,
    lastFetchedAt: now,
  };

  await db.transaction('rw', [db.repositories, db.templates, db.sources], async () => {
    await db.repositories.put(repoRecord);
    if (templatesToSave.size > 0) {
      await db.templates.bulkPut(Array.from(templatesToSave.values()));
    }
    if (resolvedRecords.length > 0) {
      await db.sources.bulkPut(resolvedRecords);
    }
  });

  await syncAllSourceRulesToBackground();

  return {
    repo: repoRecord,
    installedCount: resolvedRecords.length,
    skipped,
  };
}
