import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  ChapterEntity,
  InstalledSourceRecord,
  MangaEntity,
  MangaSourceLink,
  ReadingHistoryEntry,
  RepositoryRecord,
  TemplateRecord,
} from '@/src/core/types/manga';

export interface CoverBlobCacheEntry {
  url: string;
  referer: string;
  mimeType: string;
  blob: Blob;
  cachedAt: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 'default',
  readerMode: 'webtoon',
  readingDirection: 'ltr',
  webtoonWidth: 820,
  doublePageOffset: true,
  preloadPagesCount: 4,
  updateIntervalMinutes: 120,
};

export function normalizeMangaKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function hashStableId(input: string): string {
  // Déterministe (FNV-1a 64-bit split en 2x32) pour créer des clés stables sans dépendre du crypto async.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
}

export class KumoYomiDB extends Dexie {
  repositories!: EntityTable<RepositoryRecord, 'id'>;
  templates!: EntityTable<TemplateRecord, 'id'>;
  sources!: EntityTable<InstalledSourceRecord, 'id'>;
  mangas!: EntityTable<MangaEntity, 'id'>;
  mangaSources!: EntityTable<MangaSourceLink, 'id'>;
  chapters!: EntityTable<ChapterEntity, 'id'>;
  history!: EntityTable<ReadingHistoryEntry, 'id'>;
  coverBlobs!: EntityTable<CoverBlobCacheEntry, 'url'>;
  settings!: EntityTable<AppSettings, 'id'>;

  constructor() {
    super('kumoyomi-db');
    this.version(1).stores({
      repositories: 'id, url, lastFetchedAt',
      templates: 'id, repoId',
      sources: 'id, repoId, enabled, lang',
      mangas: 'id, normalizedKey, favorite, libraryStatus, updatedAt, unreadCount',
      mangaSources: 'id, mangaId, sourceId, sourceMangaUrl, [mangaId+sourceId], [sourceId+sourceMangaUrl]',
      chapters:
        'id, mangaId, sourceId, sourceChapterUrl, chapterNumber, read, isNew, [mangaId+sourceId], [sourceId+sourceChapterUrl]',
      history: 'id, mangaId, chapterId, readAt',
      coverBlobs: 'url, cachedAt',
      settings: 'id',
    });
  }
}

export const db = new KumoYomiDB();

export async function getOrCreateSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('default');
  if (existing) return { ...DEFAULT_APP_SETTINGS, ...existing };
  await db.settings.put(DEFAULT_APP_SETTINGS);
  return DEFAULT_APP_SETTINGS;
}
