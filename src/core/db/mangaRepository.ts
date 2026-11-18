import { db, hashStableId, normalizeMangaKey } from '@/src/core/db/db';
import type {
  ChapterEntity,
  LibraryStatus,
  MangaEntity,
  MangaSourceLink,
  ReadingHistoryEntry,
} from '@/src/core/types/manga';
import type { ParsedCatalogueItem, ParsedChapterItem, ParsedMangaDetails } from '@/src/core/types/source';

/**
 * Enregistre ou fusionne un manga découvert depuis un catalogue/recherche
 * en regroupant automatiquement les titres identiques sur la même entité locale.
 */
export async function upsertMangaFromCatalogueItem(
  item: ParsedCatalogueItem,
): Promise<{ manga: MangaEntity; link: MangaSourceLink }> {
  const normalizedKey = normalizeMangaKey(item.title) || hashStableId(item.url);
  const now = Date.now();

  return db.transaction('rw', [db.mangas, db.mangaSources], async () => {
    const existingLink = await db.mangaSources
      .where('[sourceId+sourceMangaUrl]')
      .equals([item.sourceId, item.url])
      .first();

    if (existingLink) {
      const existingManga = await db.mangas.get(existingLink.mangaId);
      if (existingManga) {
        if (!existingManga.coverUrl && item.coverUrl) {
          await db.mangas.update(existingManga.id, { coverUrl: item.coverUrl, updatedAt: now });
          existingManga.coverUrl = item.coverUrl;
        }
        return { manga: existingManga, link: existingLink };
      }
    }

    let manga = await db.mangas.where('normalizedKey').equals(normalizedKey).first();
    if (!manga) {
      manga = {
        id: `m_${hashStableId(normalizedKey)}`,
        normalizedKey,
        title: item.title,
        altTitles: [],
        coverUrl: item.coverUrl,
        publicationStatus: 'unknown',
        genres: [],
        favorite: false,
        libraryStatus: 'reading',
        preferredSourceId: item.sourceId,
        unreadCount: 0,
        addedAt: now,
        updatedAt: now,
      };
      await db.mangas.put(manga);
    } else if (!manga.coverUrl && item.coverUrl) {
      await db.mangas.update(manga.id, { coverUrl: item.coverUrl, updatedAt: now });
      manga = { ...manga, coverUrl: item.coverUrl, updatedAt: now };
    }

    const linkId = `ms_${hashStableId(`${manga.id}::${item.sourceId}`)}`;
    const link: MangaSourceLink = {
      id: linkId,
      mangaId: manga.id,
      sourceId: item.sourceId,
      sourceMangaUrl: item.url,
      sourceTitle: item.title,
      coverUrl: item.coverUrl,
      lastSyncedAt: now,
    };
    await db.mangaSources.put(link);

    return { manga, link };
  });
}

/**
 * Met à jour les métadonnées d'une fiche manga unifiée après scraping complet.
 */
export async function saveMangaDetails(
  mangaId: string,
  sourceId: string,
  details: ParsedMangaDetails,
): Promise<MangaEntity | undefined> {
  const now = Date.now();
  return db.transaction('rw', [db.mangas, db.mangaSources], async () => {
    const current = await db.mangas.get(mangaId);
    if (!current) return undefined;

    const mergedAltTitles = Array.from(
      new Set([...current.altTitles, ...(details.altTitles ?? [])].filter(Boolean)),
    );

    const updated: MangaEntity = {
      ...current,
      title: details.title || current.title,
      coverUrl: details.coverUrl || current.coverUrl,
      author: details.author ?? current.author,
      artist: details.artist ?? current.artist,
      description: details.description ?? current.description,
      publicationStatus:
        details.status !== 'unknown' ? details.status : current.publicationStatus,
      genres: details.genres.length > 0 ? details.genres : current.genres,
      altTitles: mergedAltTitles,
      updatedAt: now,
    };

    await db.mangas.put(updated);
    const linkId = `ms_${hashStableId(`${mangaId}::${sourceId}`)}`;
    await db.mangaSources.put({
      id: linkId,
      mangaId,
      sourceId,
      sourceMangaUrl: details.url,
      sourceTitle: details.title || current.title,
      coverUrl: details.coverUrl || current.coverUrl,
      lastSyncedAt: now,
    });

    return updated;
  });
}

/**
 * Synchronise la liste des chapitres d'une source tout en préservant l'état lu/progression
 * et en propageant les numéros de chapitres déjà lus sur d'autres sources du même manga.
 */
export async function syncSourceChapters(
  mangaId: string,
  sourceId: string,
  parsedChapters: ParsedChapterItem[],
  options: { markNewIfFavorite?: boolean } = {},
): Promise<{ chapters: ChapterEntity[]; newlyAddedCount: number }> {
  const now = Date.now();

  return db.transaction('rw', [db.chapters, db.mangas], async () => {
    const manga = await db.mangas.get(mangaId);
    const existingForSource = await db.chapters
      .where('[mangaId+sourceId]')
      .equals([mangaId, sourceId])
      .toArray();
    const existingAllSources = await db.chapters.where('mangaId').equals(mangaId).toArray();

    const existingByUrl = new Map<string, ChapterEntity>();
    for (const ch of existingForSource) {
      existingByUrl.set(ch.sourceChapterUrl, ch);
    }

    const readNumbersAcrossSources = new Set<number>();
    for (const ch of existingAllSources) {
      if (ch.read && ch.chapterNumber !== null) {
        readNumbersAcrossSources.add(ch.chapterNumber);
      }
    }

    const hadExistingChapters = existingForSource.length > 0;
    let newlyAddedCount = 0;

    const nextChapters: ChapterEntity[] = parsedChapters.map((item, idx) => {
      const prev = existingByUrl.get(item.url);
      const isNewDiscovery =
        !prev && hadExistingChapters && Boolean(options.markNewIfFavorite && manga?.favorite);

      if (isNewDiscovery) {
        newlyAddedCount += 1;
      }

      const inheritedRead =
        prev?.read ??
        (item.chapterNumber !== null && readNumbersAcrossSources.has(item.chapterNumber));

      return {
        id: prev?.id ?? `ch_${hashStableId(`${mangaId}::${sourceId}::${item.url}`)}`,
        mangaId,
        sourceId,
        sourceChapterUrl: item.url,
        title: item.title,
        chapterNumber: item.chapterNumber,
        orderIndex: idx,
        publishedAt: item.publishedAt ?? prev?.publishedAt,
        read: inheritedRead,
        lastPageRead: prev?.lastPageRead ?? 0,
        totalPages: prev?.totalPages ?? 0,
        isNew: prev ? prev.isNew : isNewDiscovery,
        fetchedAt: now,
      };
    });

    await db.chapters.where('[mangaId+sourceId]').equals([mangaId, sourceId]).delete();
    if (nextChapters.length > 0) {
      await db.chapters.bulkPut(nextChapters);
    }

    const unreadCount = nextChapters.filter((c) => !c.read).length;
    const maxChapterNumber = nextChapters.reduce<number | undefined>((max, c) => {
      if (c.chapterNumber === null) return max;
      return max === undefined || c.chapterNumber > max ? c.chapterNumber : max;
    }, undefined);

    if (manga) {
      await db.mangas.update(mangaId, {
        unreadCount,
        latestChapterNumber: maxChapterNumber ?? manga.latestChapterNumber,
        lastCheckedAt: now,
        updatedAt: newlyAddedCount > 0 ? now : manga.updatedAt,
      });
    }

    return { chapters: nextChapters, newlyAddedCount };
  });
}

export async function toggleFavoriteManga(
  mangaId: string,
  favorite: boolean,
  libraryStatus: LibraryStatus = 'reading',
): Promise<void> {
  await db.mangas.update(mangaId, {
    favorite,
    libraryStatus,
    updatedAt: Date.now(),
  });
}

export async function setPreferredSource(mangaId: string, sourceId: string): Promise<void> {
  await db.mangas.update(mangaId, {
    preferredSourceId: sourceId,
    updatedAt: Date.now(),
  });
}

export async function markChaptersReadState(
  mangaId: string,
  sourceId: string,
  chapterIds: string[],
  read: boolean,
): Promise<void> {
  await db.transaction('rw', [db.chapters, db.mangas], async () => {
    for (const id of chapterIds) {
      await db.chapters.update(id, { read, isNew: false });
    }
    const all = await db.chapters
      .where('[mangaId+sourceId]')
      .equals([mangaId, sourceId])
      .toArray();
    const unreadCount = all.filter((c) => !c.read).length;
    await db.mangas.update(mangaId, { unreadCount });
  });
}

export async function recordChapterProgress(params: {
  mangaId: string;
  chapterId: string;
  sourceId: string;
  pageIndex: number;
  totalPages: number;
  markRead?: boolean;
}): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', [db.chapters, db.mangas, db.history], async () => {
    const chapter = await db.chapters.get(params.chapterId);
    const manga = await db.mangas.get(params.mangaId);
    if (!chapter || !manga) return;

    const shouldMarkRead =
      params.markRead ||
      (params.totalPages > 0 && params.pageIndex >= params.totalPages - 1);

    await db.chapters.update(chapter.id, {
      lastPageRead: params.pageIndex,
      totalPages: params.totalPages,
      read: chapter.read || shouldMarkRead,
      isNew: false,
    });

    if (shouldMarkRead && !chapter.read) {
      const siblingChapters = await db.chapters
        .where('[mangaId+sourceId]')
        .equals([params.mangaId, params.sourceId])
        .toArray();
      const unreadCount = siblingChapters.filter((c) => !c.read && c.id !== chapter.id).length;
      await db.mangas.update(manga.id, { unreadCount });
    }

    const historyEntry: ReadingHistoryEntry = {
      id: `hist_${manga.id}`,
      mangaId: manga.id,
      chapterId: chapter.id,
      sourceId: params.sourceId,
      mangaTitle: manga.title,
      chapterTitle: chapter.title,
      coverUrl: manga.coverUrl,
      pageIndex: params.pageIndex,
      totalPages: params.totalPages,
      readAt: now,
    };
    await db.history.put(historyEntry);
  });
}
