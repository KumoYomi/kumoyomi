import { useLiveQuery } from 'dexie-react-hooks';
import { BookMarked, Compass, Loader2, Play, Plus, RefreshCw, Search, Tag, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { navigate } from '@/src/app/router';
import { AntiHotlinkImage } from '@/src/components/AntiHotlinkImage';
import { CustomSelect } from '@/src/components/CustomSelect';
import { UpdateCheckStatusBanner } from '@/src/components/UpdateCheckStatusBanner';
import { DEFAULT_APP_SETTINGS, db } from '@/src/core/db/db';
import { addCustomCategory, removeCustomCategory } from '@/src/core/db/mangaRepository';
import type { UpdateCheckSummary } from '@/src/core/extension/browserBridge';
import { INTL_LOCALE_TAG, useTranslation } from '@/src/core/i18n';
import type { LibraryStatus, MangaEntity } from '@/src/core/types/manga';
import { checkLibraryUpdates } from '@/src/core/updater/updateChecker';

type LibrarySortKey = 'updated' | 'title' | 'unread' | 'added';

const FILTER_KEYS: Array<'all' | LibraryStatus> = [
  'all',
  'reading',
  'plan_to_read',
  'completed',
  'on_hold',
  'dropped',
];

export function LibraryPage() {
  const { locale, t } = useTranslation();
  const favorites =
    useLiveQuery(
      () =>
        db.mangas
          .filter((m) => m.favorite)
          .toArray()
          .then((list) => list.sort((a, b) => b.updatedAt - a.updatedAt)),
      [],
      [],
    ) ?? [];

  const allSources = useLiveQuery(() => db.sources.toArray(), [], []) ?? [];
  const sourceById = useMemo(() => new Map(allSources.map((s) => [s.id, s])), [allSources]);
  const settings = useLiveQuery(() => db.settings.get('default'), [], DEFAULT_APP_SETTINGS);
  const customCategories = settings?.customCategories ?? [];

  const [statusFilter, setStatusFilter] = useState<'all' | LibraryStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<LibrarySortKey>('updated');
  const [titleQuery, setTitleQuery] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);
  const [updateSummary, setUpdateSummary] = useState<UpdateCheckSummary | null>(null);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: favorites.length };
    for (const m of favorites) {
      counts[m.libraryStatus] = (counts[m.libraryStatus] ?? 0) + 1;
    }
    return counts;
  }, [favorites]);

  const visibleMangas = useMemo(() => {
    const filtered = favorites.filter((m) => {
      if (statusFilter !== 'all' && m.libraryStatus !== statusFilter) return false;
      if (categoryFilter === '__uncategorized__') {
        if (m.categories && m.categories.length > 0) return false;
      } else if (categoryFilter !== 'all') {
        if (!m.categories?.some((c) => c.toLowerCase() === categoryFilter.toLowerCase())) {
          return false;
        }
      }
      if (sourceFilter !== 'all' && m.preferredSourceId !== sourceFilter) return false;
      if (titleQuery.trim()) {
        const q = titleQuery.trim().toLowerCase();
        return m.title.toLowerCase().includes(q);
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, INTL_LOCALE_TAG[locale]);
      if (sortBy === 'unread') {
        if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
        return b.updatedAt - a.updatedAt;
      }
      if (sortBy === 'added') return b.addedAt - a.addedAt;
      return b.updatedAt - a.updatedAt;
    });
  }, [favorites, statusFilter, categoryFilter, sourceFilter, sortBy, titleQuery, locale]);

  async function handleQuickReadManga(manga: MangaEntity) {
    const sourceId = manga.preferredSourceId;
    if (!sourceId) {
      navigate({ name: 'manga', mangaId: manga.id });
      return;
    }
    const chapters = await db.chapters
      .where('[mangaId+sourceId]')
      .equals([manga.id, sourceId])
      .toArray();
    if (chapters.length === 0) {
      navigate({ name: 'manga', mangaId: manga.id });
      return;
    }
    const ascending = [...chapters].sort((a, b) => b.orderIndex - a.orderIndex);
    const target = ascending.find((c) => !c.read) ?? ascending[ascending.length - 1];
    if (target) {
      navigate({ name: 'reader', mangaId: manga.id, chapterId: target.id });
    } else {
      navigate({ name: 'manga', mangaId: manga.id });
    }
  }

  async function handleCheckAllUpdates() {
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

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="ky-heading text-2xl font-bold tracking-tight">{t('library.title')}</h1>
          <p className="ky-muted mt-1 text-sm">
            {t('library.subtitle', { count: favorites.length })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-52">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ky-text-soft)]" />
            <input
              type="search"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              placeholder={t('library.filterPlaceholder')}
              className="ky-input w-full rounded-xl py-2 pl-9 pr-3 text-xs"
            />
          </div>

          {allSources.length > 1 && (
            <CustomSelect
              ariaLabel={t('library.filterSourceAria')}
              value={sourceFilter}
              options={[
                { value: 'all', label: t('library.allSources') },
                ...allSources.map((s) => ({
                  value: s.id,
                  label: s.name,
                  badge: s.lang.toUpperCase(),
                })),
              ]}
              onChange={setSourceFilter}
            />
          )}

          <CustomSelect
            ariaLabel={t('library.sortAria')}
            align="right"
            value={sortBy}
            options={[
              { value: 'updated', label: t('library.sortUpdated') },
              { value: 'unread', label: t('library.sortUnread') },
              { value: 'title', label: t('library.sortTitle') },
              { value: 'added', label: t('library.sortAdded') },
            ]}
            onChange={(val) => setSortBy(val as LibrarySortKey)}
          />

          <button
            type="button"
            disabled={checkingUpdates || favorites.length === 0}
            onClick={() => void handleCheckAllUpdates()}
            className="ky-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            {checkingUpdates ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('library.checkUpdates')}
          </button>
        </div>
      </header>

      {/* Onglets de statut */}
      <div className="flex flex-wrap gap-1.5 border-b border-[var(--ky-border)] pb-3">
        {FILTER_KEYS.map((key) => {
          const count = tabCounts[key] ?? 0;
          if (key === 'dropped' && count === 0 && statusFilter !== 'dropped') return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                statusFilter === key
                  ? 'ky-pill-active'
                  : 'text-[var(--ky-text-muted)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)]'
              }`}
            >
              <span>{t(`libStatus.${key}`)}</span>
              <span className="rounded bg-[var(--ky-surface-2)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--ky-text-muted)]">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom categories bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ky-text-soft)]">
          <Tag className="h-3.5 w-3.5 text-violet-400" />
          {t('categories.label')}:
        </span>
        <button
          type="button"
          onClick={() => setCategoryFilter('all')}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
            categoryFilter === 'all'
              ? 'ky-pill-active'
              : 'text-[var(--ky-text-muted)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)]'
          }`}
        >
          {t('categories.all')}
        </button>
        {customCategories.map((cat) => (
          <div
            key={cat}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium transition ${
              categoryFilter === cat
                ? 'ky-pill-active border-transparent'
                : 'border-[var(--ky-border)] bg-[var(--ky-surface)] text-[var(--ky-text-secondary)]'
            }`}
          >
            <button type="button" onClick={() => setCategoryFilter(cat)} className="px-0.5">
              {cat}
            </button>
            <button
              type="button"
              title={t('categories.removeTooltip', { name: cat })}
              aria-label={t('categories.removeTooltip', { name: cat })}
              onClick={() => {
                if (categoryFilter === cat) setCategoryFilter('all');
                void removeCustomCategory(cat);
              }}
              className="rounded p-0.5 text-[var(--ky-text-soft)] hover:bg-black/20 hover:text-rose-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {customCategories.length > 0 && (
          <button
            type="button"
            onClick={() => setCategoryFilter('__uncategorized__')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              categoryFilter === '__uncategorized__'
                ? 'ky-pill-active'
                : 'text-[var(--ky-text-muted)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)]'
            }`}
          >
            {t('categories.uncategorized')}
          </button>
        )}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!newCategoryName.trim()) return;
            const val = newCategoryName.trim();
            setNewCategoryName('');
            void addCustomCategory(val);
          }}
          className="inline-flex items-center gap-1"
        >
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={t('categories.newPlaceholder')}
            className="ky-input w-36 rounded-lg px-2.5 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={!newCategoryName.trim()}
            className="ky-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            {t('categories.addBtn')}
          </button>
        </form>
      </div>

      <UpdateCheckStatusBanner
        progress={checkProgress}
        summary={updateSummary}
        sourceById={sourceById}
        onRetry={() => void handleCheckAllUpdates()}
      />

      {favorites.length === 0 ? (
        <div className="ky-surface rounded-3xl border border-dashed p-10 text-center sm:p-14">
          <BookMarked className="mx-auto h-11 w-11 text-[var(--ky-accent-text)] opacity-80" />
          <h2 className="ky-heading mt-4 text-lg font-semibold">{t('library.emptyTitle')}</h2>
          <p className="ky-muted mx-auto mt-2 max-w-md text-sm">{t('library.emptyDesc')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ name: 'sources' })}
              className="ky-btn-secondary rounded-xl px-4 py-2.5 text-xs font-semibold"
            >
              {t('library.configureSources')}
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: 'explore' })}
              className="ky-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold"
            >
              <Compass className="h-4 w-4" />
              {t('library.exploreManga')}
            </button>
          </div>
        </div>
      ) : visibleMangas.length === 0 ? (
        <div className="ky-surface ky-muted rounded-2xl border p-10 text-center text-sm">
          {t('library.noFilterMatch')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {visibleMangas.map((manga) => {
            const preferredSrc = manga.preferredSourceId
              ? sourceById.get(manga.preferredSourceId)
              : undefined;
            return (
              <div
                key={manga.id}
                className="ky-card group relative flex flex-col overflow-hidden rounded-2xl hover:-translate-y-0.5"
              >
                <button
                  type="button"
                  onClick={() => navigate({ name: 'manga', mangaId: manga.id })}
                  className="flex flex-1 flex-col text-left"
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-black/25">
                    <AntiHotlinkImage
                      src={manga.coverUrl}
                      referer={preferredSrc?.baseUrl}
                      alt={manga.title}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    {manga.unreadCount > 0 && (
                      <span className="ky-accent-badge absolute right-2 top-2 rounded-lg px-2 py-0.5 text-xs font-bold shadow">
                        {manga.unreadCount}
                      </span>
                    )}
                    {preferredSrc && (
                      <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-medium text-sky-200 ring-1 ring-white/10 backdrop-blur">
                        {preferredSrc.name}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 sm:p-3">
                    <h3 className="ky-heading line-clamp-2 text-xs font-semibold group-hover:text-[var(--ky-accent-text)] sm:text-sm">
                      {manga.title}
                    </h3>
                  </div>
                </button>
                <button
                  type="button"
                  title={t('library.resumeTooltip')}
                  onClick={() => void handleQuickReadManga(manga)}
                  className="ky-btn-primary absolute bottom-12 right-2 rounded-xl p-2 opacity-90 shadow-lg transition sm:bottom-14 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
