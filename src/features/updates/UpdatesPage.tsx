import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, Clock, Play } from 'lucide-react';
import { useMemo } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { db } from '@/src/core/db/db';

export function UpdatesPage() {
  const historyEntries =
    useLiveQuery(() => db.history.orderBy('readAt').reverse().limit(12).toArray(), [], []) ?? [];

  const newChapters =
    useLiveQuery(
      () =>
        db.chapters
          .filter((c) => c.isNew && !c.read)
          .toArray()
          .then((list) => list.sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 60)),
      [],
      [],
    ) ?? [];

  const mangas = useLiveQuery(() => db.mangas.toArray(), [], []) ?? [];
  const sources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];

  const mangaMap = useMemo(() => new Map(mangas.map((m) => [m.id, m])), [mangas]);
  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  return (
    <div className="space-y-9">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Nouveautés & Historique</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Reprenez instantanément votre lecture et suivez les derniers chapitres détectés.
        </p>
      </header>

      {/* Historique de lecture */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <Clock className="h-4 w-4 text-rose-400" />
          Reprendre la lecture
        </div>

        {historyEntries.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-8 text-center text-sm text-zinc-500">
            Aucun historique de lecture enregistré pour le moment.
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
                      Page {entry.pageIndex + 1}
                      {entry.totalPages > 0 ? ` / ${entry.totalPages}` : ''} ·{' '}
                      {new Date(entry.readAt).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                      })}
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
                    title="Reprendre"
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
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <Bell className="h-4 w-4 text-rose-400" />
          Nouveaux chapitres ({newChapters.length})
        </div>

        {newChapters.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#12121a] p-8 text-center text-sm text-zinc-500">
            Aucun nouveau chapitre en attente. Cliquez sur « Vérifier les sorties » dans votre
            Bibliothèque.
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
                        {m?.title ?? 'Série'}
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
                    Lire
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
