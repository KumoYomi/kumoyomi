import type { MangaPublicationStatus, RawSourceConfig, SourceConfig, SourceTemplateConfig } from './source';

export type LibraryStatus = 'reading' | 'plan_to_read' | 'completed' | 'on_hold' | 'dropped';

export type ReaderMode = 'webtoon' | 'single' | 'double';
export type ReadingDirection = 'ltr' | 'rtl';
export type PageFitMode = 'contain' | 'width' | 'original';
export type AppLocale = 'en' | 'fr' | 'es' | 'zh';
export type ThemeMode = 'midnight' | 'obsidian' | 'twilight' | 'paper';
export type AccentPreset = 'aurora' | 'sakura' | 'ocean' | 'emerald' | 'amber' | 'violet';

export interface OfflineChapterMeta {
  chapterId: string;
  mangaId: string;
  sourceId: string;
  chapterTitle: string;
  pageCount: number;
  totalBytes: number;
  cachedAt: number;
}

export interface OfflinePageBlob {
  /** Clé composite `${chapterId}:${pageIndex}` */
  id: string;
  chapterId: string;
  pageIndex: number;
  imageUrl: string;
  mimeType: string;
  blob: Blob;
}

export interface RepositoryRecord {
  id: string;
  name: string;
  url: string;
  description?: string;
  version?: string;
  lastFetchedAt: number;
  error?: string;
}

export interface TemplateRecord {
  id: string;
  repoId: string;
  config: SourceTemplateConfig;
  updatedAt: number;
}

export interface InstalledSourceRecord {
  id: string;
  repoId: string;
  name: string;
  lang: string;
  baseUrl: string;
  enabled: boolean;
  extendsId?: string;
  rawConfig: RawSourceConfig;
  resolvedConfig: SourceConfig;
  lastError?: string;
  updatedAt: number;
}

export interface MangaEntity {
  id: string;
  normalizedKey: string;
  title: string;
  altTitles: string[];
  coverUrl?: string;
  author?: string;
  artist?: string;
  description?: string;
  publicationStatus: MangaPublicationStatus;
  genres: string[];
  favorite: boolean;
  libraryStatus: LibraryStatus;
  categories?: string[];
  preferredSourceId?: string;
  unreadCount: number;
  latestChapterNumber?: number;
  lastCheckedAt?: number;
  addedAt: number;
  updatedAt: number;
}

export interface MangaSourceLink {
  id: string;
  mangaId: string;
  sourceId: string;
  sourceMangaUrl: string;
  sourceTitle: string;
  coverUrl?: string;
  lastSyncedAt: number;
}

export interface ChapterEntity {
  id: string;
  mangaId: string;
  sourceId: string;
  sourceChapterUrl: string;
  title: string;
  chapterNumber: number | null;
  orderIndex: number;
  publishedAt?: number;
  read: boolean;
  lastPageRead: number;
  totalPages: number;
  isNew: boolean;
  fetchedAt: number;
}

export interface ReadingHistoryEntry {
  id: string;
  mangaId: string;
  chapterId: string;
  sourceId: string;
  mangaTitle: string;
  chapterTitle: string;
  coverUrl?: string;
  pageIndex: number;
  totalPages: number;
  readAt: number;
}

export interface AppSettings {
  id: 'default';
  language?: AppLocale;
  themeMode?: ThemeMode;
  accentColor?: AccentPreset;
  readerMode: ReaderMode;
  readingDirection: ReadingDirection;
  pageFitMode?: PageFitMode;
  webtoonWidth: number;
  webtoonGap?: number;
  doublePageOffset: boolean;
  preloadPagesCount: number;
  updateIntervalMinutes: number;
  autoOpenCloudflarePopup?: boolean;
  autoDeleteOfflineOnRead?: boolean;
  desktopNotifications?: boolean;
  customCategories?: string[];
  lastGlobalUpdateCheck?: number;
}

export interface KumoYomiBackupPayload {
  schemaVersion: 1;
  exportedAt: number;
  repositories: RepositoryRecord[];
  templates: TemplateRecord[];
  sources: InstalledSourceRecord[];
  mangas: MangaEntity[];
  mangaSources: MangaSourceLink[];
  chapters: ChapterEntity[];
  history: ReadingHistoryEntry[];
  settings: AppSettings;
}
