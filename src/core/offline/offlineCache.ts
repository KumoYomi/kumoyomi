import { db } from '@/src/core/db/db';
import { fetchImageBlob } from '@/src/core/image-loader/blobImageLoader';
import { parserEngine } from '@/src/core/parser/engine';
import type {
  ChapterEntity,
  InstalledSourceRecord,
  OfflineChapterMeta,
  OfflinePageBlob,
} from '@/src/core/types/manga';
import type { ParsedPageItem } from '@/src/core/types/source';

export interface OfflineDownloadProgress {
  chapterId: string;
  completedPages: number;
  totalPages: number;
}

/**
 * Télécharge toutes les planches d'un chapitre en IndexedDB pour une lecture 100 % hors-ligne.
 */
export async function downloadChapterOffline(
  chapter: ChapterEntity,
  source: InstalledSourceRecord,
  onProgress?: (progress: OfflineDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<OfflineChapterMeta> {
  const pages = await parserEngine.getChapterPages(
    source.resolvedConfig,
    chapter.sourceChapterUrl,
  );
  if (pages.length === 0) {
    throw new Error('Aucune planche trouvée pour ce chapitre.');
  }

  onProgress?.({ chapterId: chapter.id, completedPages: 0, totalPages: pages.length });

  const blobs: OfflinePageBlob[] = [];
  let totalBytes = 0;

  for (let i = 0; i < pages.length; i += 1) {
    if (signal?.aborted) {
      throw new DOMException('Téléchargement annulé', 'AbortError');
    }
    const page = pages[i]!;
    const blob = await fetchImageBlob(page.imageUrl, source.baseUrl, 'normal');
    totalBytes += blob.size;
    blobs.push({
      id: `${chapter.id}:${page.index}`,
      chapterId: chapter.id,
      pageIndex: page.index,
      imageUrl: page.imageUrl,
      mimeType: blob.type || 'image/jpeg',
      blob,
    });
    onProgress?.({ chapterId: chapter.id, completedPages: i + 1, totalPages: pages.length });
  }

  const meta: OfflineChapterMeta = {
    chapterId: chapter.id,
    mangaId: chapter.mangaId,
    sourceId: source.id,
    chapterTitle: chapter.title,
    pageCount: blobs.length,
    totalBytes,
    cachedAt: Date.now(),
  };

  await db.transaction('rw', [db.offlineChapters, db.chapterPageBlobs], async () => {
    await db.chapterPageBlobs.where('chapterId').equals(chapter.id).delete();
    await db.chapterPageBlobs.bulkPut(blobs);
    await db.offlineChapters.put(meta);
  });

  return meta;
}

/**
 * Retourne les pages d'un chapitre depuis le stockage hors-ligne IndexedDB si disponible.
 */
export async function getOfflineChapterPages(chapterId: string): Promise<ParsedPageItem[] | null> {
  const meta = await db.offlineChapters.get(chapterId);
  if (!meta) return null;
  const rows = await db.chapterPageBlobs.where('chapterId').equals(chapterId).sortBy('pageIndex');
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    index: row.pageIndex,
    imageUrl: row.imageUrl,
  }));
}

export async function removeOfflineChapter(chapterId: string): Promise<void> {
  await db.transaction('rw', [db.offlineChapters, db.chapterPageBlobs], async () => {
    await db.chapterPageBlobs.where('chapterId').equals(chapterId).delete();
    await db.offlineChapters.delete(chapterId);
  });
}

export async function clearAllOfflineChapters(): Promise<void> {
  await db.transaction('rw', [db.offlineChapters, db.chapterPageBlobs], async () => {
    await db.chapterPageBlobs.clear();
    await db.offlineChapters.clear();
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} Ko`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} Mo`;
  return `${(mb / 1024).toFixed(2)} Go`;
}
