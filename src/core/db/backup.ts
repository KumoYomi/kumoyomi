import { DEFAULT_APP_SETTINGS, db, getOrCreateSettings } from '@/src/core/db/db';
import type { KumoYomiBackupPayload } from '@/src/core/types/manga';

export async function exportBackupPayload(): Promise<KumoYomiBackupPayload> {
  const [repositories, templates, sources, mangas, mangaSources, chapters, history, settings] =
    await Promise.all([
      db.repositories.toArray(),
      db.templates.toArray(),
      db.sources.toArray(),
      db.mangas.toArray(),
      db.mangaSources.toArray(),
      db.chapters.toArray(),
      db.history.toArray(),
      getOrCreateSettings(),
    ]);

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    repositories,
    templates,
    sources,
    mangas,
    mangaSources,
    chapters,
    history,
    settings,
  };
}

export function triggerJsonDownload(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackupJson(rawJson: string): Promise<{
  mangasCount: number;
  sourcesCount: number;
  chaptersCount: number;
}> {
  const parsed: unknown = JSON.parse(rawJson);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Fichier de sauvegarde invalide (objet JSON attendu).');
  }

  const payload = parsed as Partial<KumoYomiBackupPayload>;
  if (payload.schemaVersion !== 1) {
    throw new Error('Version de sauvegarde non supportée.');
  }

  const repositories = Array.isArray(payload.repositories) ? payload.repositories : [];
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const mangas = Array.isArray(payload.mangas) ? payload.mangas : [];
  const mangaSources = Array.isArray(payload.mangaSources) ? payload.mangaSources : [];
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const history = Array.isArray(payload.history) ? payload.history : [];
  const settings = payload.settings ?? DEFAULT_APP_SETTINGS;

  await db.transaction(
    'rw',
    [
      db.repositories,
      db.templates,
      db.sources,
      db.mangas,
      db.mangaSources,
      db.chapters,
      db.history,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.repositories.clear(),
        db.templates.clear(),
        db.sources.clear(),
        db.mangas.clear(),
        db.mangaSources.clear(),
        db.chapters.clear(),
        db.history.clear(),
      ]);

      if (repositories.length) await db.repositories.bulkPut(repositories);
      if (templates.length) await db.templates.bulkPut(templates);
      if (sources.length) await db.sources.bulkPut(sources);
      if (mangas.length) await db.mangas.bulkPut(mangas);
      if (mangaSources.length) await db.mangaSources.bulkPut(mangaSources);
      if (chapters.length) await db.chapters.bulkPut(chapters);
      if (history.length) await db.history.bulkPut(history);
      await db.settings.put({ ...DEFAULT_APP_SETTINGS, ...settings, id: 'default' });
    },
  );

  return {
    mangasCount: mangas.length,
    sourcesCount: sources.length,
    chaptersCount: chapters.length,
  };
}
