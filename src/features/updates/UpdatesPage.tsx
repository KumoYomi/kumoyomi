import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bell,
  BookMarked,
  BookOpenCheck,
  CheckCheck,
  Clock,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { UpdateCheckStatusBanner } from '@/src/components/UpdateCheckStatusBanner';
import { db } from '@/src/core/db/db';
import {
  sendBackgroundMessage,
  type UpdateCheckSummary,
} from '@/src/core/extension/browserBridge';
import { useTranslation } from '@/src/core/i18n';
import { checkLibraryUpdates } from '@/src/core/updater/updateChecker';

export function UpdatesPage() {
  const { t, formatDate } = useTranslation();
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllNew, setShowAllNew] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);
  const [updateSummary, setUpdateSummary] = useState<UpdateCheckSummary | null>(null);

  const historyLimit = showAllHistory ? 100 : 12;
  const newLimit = showAllNew ? 250 : 60;

  const historyEntries =
    useLiveQuery(
      () => db.history.orderBy('readAt').reverse().limit(historyLimit).toArray(),
      [historyLimit],
      [],
    ) ?? [];

  const newChapters =
    useLiveQuery(
      () =>
        db.chapters
          .filter((c) => c.isNew && !c.read)
          .toArray()
          .then((list) => list.sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, newLimit)),
      [newLimit],
      [],
    ) ?? [];

  const mangas = useLiveQuery(() => db.mangas.toArray(), [], []) ?? [];
  const sources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];
  const readChaptersCount = useLiveQuery(() => db.chapters.filter((c) => c.read).count(), [], 0) ?? 0;
  const totalHistoryCount = useLiveQuery(() => db.history.count(), [], 0) ?? 0;
  const offlineCount = useLiveQuery(() => db.offlineChapters.count(), [], 0) ?? 0;
  const followedCount = useMemo(() => mangas.filter((m) => m.favorite).length, [mangas]);

  const mangaMap = useMemo(() => new Map(mangas.map((m) => [m.id, m])), [mangas]);
  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  async function handleCheckUpdates() {
    setCheckingUpdates(true);
    setUpdateSummary(null);
    setCheckProgress(null);
    try {
      const summary = await checkLibraryUpdates((current, total, title) => {
        setCheckProgress({ current, total, title });
      });
      setUpdateSummary(summary);
    } finally {
      setCheckingUpdates(false);
      setCheckProgress(null);
    }
  }

  async function handleDismissNewFlags() {
    await db.chapters.filter((c) => c.isNew).modify({ isNew: false });
    await sendBackgroundMessage({ type: 'SET_BADGE_COUNT', count: 0 });
  }

  return (
    <div className="space-y-9">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{t('updates.title')}</h1>
          <p className="mt-1 text-sm text-zinc-400">{t('updates.subtitle')}</p>
        </div>

        <button
          type="button"
          disabled={checkingUpdates}
          onClick={() => void handleCheckUpdates()}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
        >
          {checkingUpdates ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t('library.checkUpdates')}
        </button>
      </header>

      <UpdateCheckStatusBanner
        progress={checkProgress}
        summary={updateSummary}
        sourceById={sourceMap}
        onRetry={() => void handleCheckUpdates()}
      />

      {/* Local reading statistics */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <BookMarked className="h-3.5 w-3.5 text-rose-400" />
            <span>{t('stats.followedSeries')}</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-white">{followedCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <BookOpenCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('stats.chaptersRead')}</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-white">{readChaptersCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Clock className="h-3.5 w-3.5 text-indigo-400" />
            <span>{t('stats.historyEntries')}</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-white">{totalHistoryCount}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-[#12121a] p-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <HardDrive className="h-3.5 w-3.5 text-amber-400" />
            <span>{t('stats.offlineChapters')}</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-white">{offlineCount}</p>
        </div>
      </section>

      {/* Historique de lecture */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Clock className="h-4 w-4 text-rose-400" />
            {t('updates.resumeSection')}
          </div>
          {historyEntries.length > 0 && (
            <div className="flex items-center gap-2">
              {historyEntries.length >= 12 && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  {showAllHistory ? t('updates.collapse') : t('updates.showAll')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void db.history.clear()}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('updates.clearHistory')}
              </button>
            </div>
          )}
        </div>

        {historyEntries.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-8 text-center text-sm text-zinc-500">
            {t('updates.emptyHistory')}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {historyEntries.map((entry) => {
              const src = sourceMap.get(entry.sourceId);
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3.5 rounded-2xl border border-zinc-800/80 bg-[#12121a] p-3 transition hover:border-zinc-700"
                >
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'manga', mangaId: entry.mangaId })}
                    className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-900"
                  >
                    <AntiHotlinkImage
                      src={entry.coverUrl}
                      referer={src?.baseUrl}
                      alt={entry.mangaTitle}
                      className="h-full w-full object-cover"
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => navigate({ name: 'manga', mangaId: entry.mangaId })}
                      className="block truncate text-left text-sm font-semibold text-white hover:text-rose-300"
                    >
                      {entry.mangaTitle}
                    </button>
                    <p className="truncate text-xs text-zinc-400">{entry.chapterTitle}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {t('updates.pageProgress', { page: entry.pageIndex + 1 })}
                      {entry.totalPages > 0 ? ` / ${entry.totalPages}` : ''} ·{' '}
                      {formatDate(entry.readAt)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        name: 'reader',
                        mangaId: entry.mangaId,
                        chapterId: entry.chapterId,
                      })
                    }
                    className="shrink-0 rounded-xl bg-rose-600 p-2.5 text-white transition hover:bg-rose-500"
                    title={t('updates.resumeBtn')}
                  >
                    <Play className="h-4 w-4 fill-current" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Nouveaux chapitres détectés */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Bell className="h-4 w-4 text-rose-400" />
            {t('updates.newChaptersSection', { count: newChapters.length })}
          </div>
          {newChapters.length > 0 && (
            <div className="flex items-center gap-2">
              {newChapters.length >= 60 && (
                <button
                  type="button"
                  onClick={() => setShowAllNew((v) => !v)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  {showAllNew ? t('updates.collapse') : t('updates.showAll')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDismissNewFlags()}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                <CheckCheck className="h-3.5 w-3.5 text-rose-400" />
                {t('updates.markAllSeen')}
              </button>
            </div>
          )}
        </div>

        {newChapters.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-8 text-center text-sm text-zinc-500">
            {t('updates.emptyNew')}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/70 overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#12121a]">
            {newChapters.map((ch) => {
              const m = mangaMap.get(ch.mangaId);
              const s = sourceMap.get(ch.sourceId);
              return (
                <div
                  key={ch.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-900/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                      <AntiHotlinkImage
                        src={m?.coverUrl}
                        referer={s?.baseUrl}
                        alt={m?.title ?? ''}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => navigate({ name: 'manga', mangaId: ch.mangaId })}
                        className="block truncate text-left text-sm font-semibold text-white hover:text-rose-300"
                      >
                        {m?.title ?? t('common.series')}
                      </button>
                      <p className="truncate text-xs text-zinc-400">
                        {ch.title} {s ? `· ${s.name}` : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      navigate({ name: 'reader', mangaId: ch.mangaId, chapterId: ch.id })
                    }
                    className="shrink-0 rounded-xl bg-rose-600/90 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                  >
                    {t('common.read')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
