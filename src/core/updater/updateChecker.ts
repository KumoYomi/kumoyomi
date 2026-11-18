import { db, getOrCreateSettings } from '@/src/core/db/db';
import { syncSourceChapters } from '@/src/core/db/mangaRepository';
import { sendBackgroundMessage, type UpdateCheckSummary } from '@/src/core/extension/browserBridge';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';

export async function checkLibraryUpdates(
  onProgress?: (current: number, total: number, title: string) => void,
): Promise<UpdateCheckSummary> {
  const favorites = await db.mangas.filter((m) => m.favorite).toArray();
  const sources = await db.sources.toArray();
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  let newChaptersCount = 0;
  const errors: UpdateCheckSummary['errors'] = [];

  for (let i = 0; i < favorites.length; i += 1) {
    const manga = favorites[i]!;
    onProgress?.(i + 1, favorites.length, manga.title);

    const links = await db.mangaSources.where('mangaId').equals(manga.id).toArray();
    const link =
      links.find((l) => l.sourceId === manga.preferredSourceId) ?? links[0];
    if (!link) continue;

    const sourceRecord = sourceById.get(link.sourceId);
    if (!sourceRecord || !sourceRecord.enabled) continue;

    try {
      const parsedChapters = await parserEngine.getChapters(
        sourceRecord.resolvedConfig,
        link.sourceMangaUrl,
      );
      const { newlyAddedCount } = await syncSourceChapters(
        manga.id,
        sourceRecord.id,
        parsedChapters,
        { markNewIfFavorite: true },
      );
      newChaptersCount += newlyAddedCount;
    } catch (err) {
      const isCloudflare = err instanceof CloudflareChallengeError;
      errors.push({
        mangaTitle: manga.title,
        sourceId: sourceRecord.id,
        message: err instanceof Error ? err.message : 'Erreur inconnue',
        isCloudflare,
      });
    }
  }

  const settings = await getOrCreateSettings();
  await db.settings.put({
    ...settings,
    lastGlobalUpdateCheck: Date.now(),
  });

  const totalNewChapters = await db.chapters.filter((c) => c.isNew && !c.read).count();
  await sendBackgroundMessage({ type: 'SET_BADGE_COUNT', count: totalNewChapters });

  return {
    checkedMangas: favorites.length,
    newChaptersCount,
    errors,
  };
}
