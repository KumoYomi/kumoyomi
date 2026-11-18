import { db, getOrCreateSettings } from '@/src/core/db/db';
import { syncSourceChapters } from '@/src/core/db/mangaRepository';
import { sendBackgroundMessage, type UpdateCheckSummary } from '@/src/core/extension/browserBridge';
import { parserEngine } from '@/src/core/parser/engine';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';
import type { InstalledSourceRecord, MangaEntity, MangaSourceLink } from '@/src/core/types/manga';

interface QueuedUpdateTarget {
  manga: MangaEntity;
  link: MangaSourceLink;
  sourceRecord: InstalledSourceRecord;
  host: string;
}

function safeHostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return rawUrl;
  }
}

function interleaveBySource(targets: QueuedUpdateTarget[]): QueuedUpdateTarget[] {
  const buckets = new Map<string, QueuedUpdateTarget[]>();
  for (const item of targets) {
    const list = buckets.get(item.sourceRecord.id);
    if (list) {
      list.push(item);
    } else {
      buckets.set(item.sourceRecord.id, [item]);
    }
  }

  const queues = Array.from(buckets.values());
  const interleaved: QueuedUpdateTarget[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        interleaved.push(next);
        added = true;
      }
    }
  }
  return interleaved;
}

export async function checkLibraryUpdates(
  onProgress?: (current: number, total: number, title: string) => void,
  options?: { minHostIntervalMs?: number },
): Promise<UpdateCheckSummary> {
  const minHostIntervalMs = options?.minHostIntervalMs ?? 650;
  const favorites = await db.mangas.filter((m) => m.favorite).toArray();
  const sources = await db.sources.toArray();
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const targets: QueuedUpdateTarget[] = [];
  for (const manga of favorites) {
    const links = await db.mangaSources.where('mangaId').equals(manga.id).toArray();
    const link = links.find((l) => l.sourceId === manga.preferredSourceId) ?? links[0];
    if (!link) continue;
    const sourceRecord = sourceById.get(link.sourceId);
    if (!sourceRecord || !sourceRecord.enabled) continue;
    targets.push({
      manga,
      link,
      sourceRecord,
      host: safeHostOf(sourceRecord.baseUrl),
    });
  }

  const queue = interleaveBySource(targets);
  let newChaptersCount = 0;
  const errors: UpdateCheckSummary['errors'] = [];
  const lastRequestAtByHost = new Map<string, number>();
  const cfErrorBySourceId = new Map<string, CloudflareChallengeError>();

  for (let i = 0; i < queue.length; i += 1) {
    const { manga, link, sourceRecord, host } = queue[i]!;
    onProgress?.(i + 1, queue.length, manga.title);

    const existingCfError = cfErrorBySourceId.get(sourceRecord.id);
    if (existingCfError) {
      errors.push({
        mangaTitle: manga.title,
        sourceId: sourceRecord.id,
        message: existingCfError.message,
        isCloudflare: true,
        probeUrl: existingCfError.requestUrl ?? existingCfError.url,
      });
      continue;
    }

    if (minHostIntervalMs > 0) {
      const lastAt = lastRequestAtByHost.get(host);
      if (lastAt !== undefined) {
        const waitMs = minHostIntervalMs - (Date.now() - lastAt);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
      lastRequestAtByHost.set(host, Date.now());
    }

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
      if (err instanceof CloudflareChallengeError) {
        cfErrorBySourceId.set(sourceRecord.id, err);
        errors.push({
          mangaTitle: manga.title,
          sourceId: sourceRecord.id,
          message: err.message,
          isCloudflare: true,
          probeUrl: err.requestUrl ?? err.url,
        });
      } else {
        errors.push({
          mangaTitle: manga.title,
          sourceId: sourceRecord.id,
          message: err instanceof Error ? err.message : 'Unknown error',
          isCloudflare: false,
        });
      }
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
