import { db, hashStableId } from '@/src/core/db/db';
import { sendBackgroundMessage } from '@/src/core/extension/browserBridge';
import { BUILT_IN_KEIYOUSHI_TEMPLATES } from '@/src/core/parser/keiyoushiThemes';
import {
  resolveSourceWithTemplates,
  validateRawSourceConfig,
  validateRepositoryManifest,
  validateTemplateConfig,
} from '@/src/core/parser/validator';
import type { InstalledSourceRecord, RepositoryRecord, TemplateRecord } from '@/src/core/types/manga';
import type { RawSourceConfig, SourceTemplateConfig } from '@/src/core/types/source';

async function buildBaseTemplateMap(): Promise<Map<string, SourceTemplateConfig>> {
  const map = new Map<string, SourceTemplateConfig>(
    Object.entries(BUILT_IN_KEIYOUSHI_TEMPLATES),
  );
  const existingTemplates = await db.templates.toArray();
  for (const t of existingTemplates) {
    map.set(t.id, t.config);
  }
  return map;
}

/**
 * Transforme une URL GitHub web (ex: https://github.com/user/repo) en URL raw index.json.
 */
export function normalizeRepositoryInputUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  const parsed = new URL(trimmed);

  if (parsed.hostname === 'github.com') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[0];
      const repo = segments[1]?.replace(/\.git$/, '');
      if (segments.length === 2) {
        return `https://raw.githubusercontent.com/${owner}/${repo}/main/index.json`;
      }
      if (segments[2] === 'blob' && segments.length >= 5) {
        const branch = segments[3];
        const filePath = segments.slice(4).join('/');
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      }
      if (segments[2] === 'tree' && segments.length >= 4) {
        const branch = segments[3];
        const dirPath = segments.slice(4).join('/');
        const suffix = dirPath ? `${dirPath}/index.json` : 'index.json';
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${suffix}`;
      }
    }
  }

  return trimmed;
}

async function fetchJsonResource<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to download ${url} (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function syncAllSourceRulesToBackground(): Promise<void> {
  const sources = await db.sources.toArray();
  await sendBackgroundMessage({
    type: 'SYNC_SOURCE_RULES',
    sources: sources.filter((s) => s.enabled).map((s) => ({ baseUrl: s.baseUrl })),
  });
}

export async function addOrRefreshRepositoryByUrl(rawInputUrl: string): Promise<{
  repo: RepositoryRecord;
  sourcesCount: number;
  templatesCount: number;
}> {
  const manifestUrl = normalizeRepositoryInputUrl(rawInputUrl);
  const rawManifest = await fetchJsonResource<unknown>(manifestUrl);
  const manifest = validateRepositoryManifest(rawManifest);
  const repoId = `repo_${hashStableId(manifestUrl)}`;
  const now = Date.now();

  const templateMap = await buildBaseTemplateMap();

  const repoTemplates: TemplateRecord[] = [];
  for (const entry of manifest.templates ?? []) {
    const rawTpl =
      typeof entry === 'string'
        ? await fetchJsonResource<unknown>(new URL(entry, manifestUrl).toString())
        : entry;
    const tpl = validateTemplateConfig(rawTpl);
    templateMap.set(tpl.id, tpl);
    repoTemplates.push({
      id: tpl.id,
      repoId,
      config: tpl,
      updatedAt: now,
    });
  }

  const rawSources: RawSourceConfig[] = [];
  for (const entry of manifest.sources) {
    const rawSrc =
      typeof entry === 'string'
        ? await fetchJsonResource<unknown>(new URL(entry, manifestUrl).toString())
        : entry;
    rawSources.push(validateRawSourceConfig(rawSrc));
  }

  const existingSources = await db.sources.toArray();
  const existingEnabledById = new Map(existingSources.map((s) => [s.id, s.enabled]));

  const resolvedRecords: InstalledSourceRecord[] = rawSources.map((rawSrc) => {
    const resolved = resolveSourceWithTemplates(rawSrc, templateMap);
    return {
      id: resolved.id,
      repoId,
      name: resolved.name,
      lang: resolved.lang,
      baseUrl: resolved.baseUrl,
      enabled: existingEnabledById.get(resolved.id) ?? true,
      extendsId: resolved.extends,
      rawConfig: rawSrc,
      resolvedConfig: resolved,
      updatedAt: now,
    };
  });

  const repoRecord: RepositoryRecord = {
    id: repoId,
    name: manifest.name,
    url: manifestUrl,
    description: manifest.description,
    version: manifest.version,
    lastFetchedAt: now,
  };

  await db.transaction('rw', [db.repositories, db.templates, db.sources], async () => {
    await db.repositories.put(repoRecord);
    if (repoTemplates.length > 0) {
      await db.templates.bulkPut(repoTemplates);
    }
    // Supprime d'anciennes sources orphelines de ce dépôt avant de réinjecter la liste à jour
    const oldRepoSources = await db.sources.where('repoId').equals(repoId).primaryKeys();
    if (oldRepoSources.length > 0) {
      await db.sources.bulkDelete(oldRepoSources);
    }
    if (resolvedRecords.length > 0) {
      await db.sources.bulkPut(resolvedRecords);
    }
  });

  await syncAllSourceRulesToBackground();

  return {
    repo: repoRecord,
    sourcesCount: resolvedRecords.length,
    templatesCount: repoTemplates.length,
  };
}

/**
 * Permet d'importer un fichier JSON local : soit un manifeste complet (index.json),
 * soit un modèle (_templates/*.json), soit une source seule.
 */
export async function importLocalJsonConfig(
  rawJsonText: string,
  label = 'Import local',
): Promise<{ message: string }> {
  const parsed: unknown = JSON.parse(rawJsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The JSON file must contain a valid object.');
  }

  const obj = parsed as Record<string, unknown>;
  const now = Date.now();
  const localRepoId = 'repo_local_imports';

  const templateMap = await buildBaseTemplateMap();

  // Cas 1 : Manifeste complet (contient un tableau "sources")
  if (Array.isArray(obj.sources)) {
    const manifest = validateRepositoryManifest(obj);
    const repoId = `repo_local_${hashStableId(manifest.name)}`;
    const templatesAdded: TemplateRecord[] = [];

    for (const entry of manifest.templates ?? []) {
      if (typeof entry === 'string') {
        throw new Error(
          `Local import: template "${entry}" is an external relative path; use a self-contained index.json or import the template file separately.`,
        );
      }
      const tpl = validateTemplateConfig(entry);
      templateMap.set(tpl.id, tpl);
      templatesAdded.push({ id: tpl.id, repoId, config: tpl, updatedAt: now });
    }

    const sourcesAdded: InstalledSourceRecord[] = [];
    for (const entry of manifest.sources) {
      if (typeof entry === 'string') {
        throw new Error(
          `Local import: source "${entry}" is an external relative path; add the repository by URL or import the source files directly.`,
        );
      }
      const rawSrc = validateRawSourceConfig(entry);
      const resolved = resolveSourceWithTemplates(rawSrc, templateMap);
      sourcesAdded.push({
        id: resolved.id,
        repoId,
        name: resolved.name,
        lang: resolved.lang,
        baseUrl: resolved.baseUrl,
        enabled: true,
        extendsId: resolved.extends,
        rawConfig: rawSrc,
        resolvedConfig: resolved,
        updatedAt: now,
      });
    }

    await db.transaction('rw', [db.repositories, db.templates, db.sources], async () => {
      await db.repositories.put({
        id: repoId,
        name: manifest.name,
        url: `local://${label}`,
        description: manifest.description,
        version: manifest.version,
        lastFetchedAt: now,
      });
      if (templatesAdded.length) await db.templates.bulkPut(templatesAdded);
      if (sourcesAdded.length) await db.sources.bulkPut(sourcesAdded);
    });

    await syncAllSourceRulesToBackground();
    return {
      message: `${sourcesAdded.length} source(s) and ${templatesAdded.length} template(s) imported from "${manifest.name}".`,
    };
  }

  // Cas 2 : Source individuelle (contient "baseUrl")
  if (typeof obj.baseUrl === 'string') {
    const rawSrc = validateRawSourceConfig(obj);
    const resolved = resolveSourceWithTemplates(rawSrc, templateMap);

    await db.transaction('rw', [db.repositories, db.sources], async () => {
      const localRepo = await db.repositories.get(localRepoId);
      if (!localRepo) {
        await db.repositories.put({
          id: localRepoId,
          name: 'Manually imported sources',
          url: 'local://manual',
          lastFetchedAt: now,
        });
      }
      await db.sources.put({
        id: resolved.id,
        repoId: localRepoId,
        name: resolved.name,
        lang: resolved.lang,
        baseUrl: resolved.baseUrl,
        enabled: true,
        extendsId: resolved.extends,
        rawConfig: rawSrc,
        resolvedConfig: resolved,
        updatedAt: now,
      });
    });

    await syncAllSourceRulesToBackground();
    return { message: `Source "${resolved.name}" imported successfully.` };
  }

  // Cas 3 : Modèle seul (_templates/*.json)
  const tpl = validateTemplateConfig(obj);
  await db.templates.put({
    id: tpl.id,
    repoId: localRepoId,
    config: tpl,
    updatedAt: now,
  });
  return { message: `Template "${tpl.id}" imported successfully.` };
}

async function deleteOfflineForSources(sourceIds: string[]): Promise<void> {
  for (const sourceId of sourceIds) {
    const cachedChapters = await db.offlineChapters
      .where('sourceId')
      .equals(sourceId)
      .primaryKeys();
    for (const chapterId of cachedChapters) {
      await db.chapterPageBlobs.where('chapterId').equals(chapterId).delete();
      await db.offlineChapters.delete(chapterId);
    }
  }
}

export async function removeRepository(repoId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.repositories, db.templates, db.sources, db.offlineChapters, db.chapterPageBlobs],
    async () => {
      await db.repositories.delete(repoId);
      const tIds = await db.templates.where('repoId').equals(repoId).primaryKeys();
      if (tIds.length) await db.templates.bulkDelete(tIds);
      const sIds = await db.sources.where('repoId').equals(repoId).primaryKeys();
      if (sIds.length) {
        await db.sources.bulkDelete(sIds);
        await deleteOfflineForSources(sIds);
      }
    },
  );
  await syncAllSourceRulesToBackground();
}

export async function removeSource(sourceId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.repositories, db.templates, db.sources, db.offlineChapters, db.chapterPageBlobs],
    async () => {
      const existing = await db.sources.get(sourceId);
      await db.sources.delete(sourceId);
      await deleteOfflineForSources([sourceId]);
      if (existing?.repoId === 'local_manual') {
        const [remSources, remTemplates] = await Promise.all([
          db.sources.where('repoId').equals('local_manual').count(),
          db.templates.where('repoId').equals('local_manual').count(),
        ]);
        if (remSources === 0 && remTemplates === 0) {
          await db.repositories.delete('local_manual');
        }
      }
    },
  );
  await syncAllSourceRulesToBackground();
}

export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  await db.sources.update(sourceId, { enabled, updatedAt: Date.now() });
  await syncAllSourceRulesToBackground();
}
