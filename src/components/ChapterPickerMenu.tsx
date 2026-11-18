import {
  ArrowUpDown,
  Check,
  ChevronDown,
  HardDrive,
  ListOrdered,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChapterEntity } from '@/src/core/types/manga';

interface ChapterPickerMenuProps {
  chapters: ChapterEntity[];
  activeChapterId: string;
  offlineChapterIds?: ReadonlySet<string>;
  onSelect: (chapterId: string) => void;
  labels: {
    selectAria: string;
    searchPlaceholder: string;
    emptyMatch: string;
    reverseOrder: string;
    pageProgress: (page: number, total: number) => string;
    newBadge: string;
  };
}

export function ChapterPickerMenu({
  chapters,
  activeChapterId,
  offlineChapterIds,
  onSelect,
  labels,
}: ChapterPickerMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [descending, setDescending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeIndex = useMemo(
    () => chapters.findIndex((c) => c.id === activeChapterId),
    [chapters, activeChapterId],
  );
  const activeChapter = activeIndex >= 0 ? chapters[activeIndex] : undefined;

  const displayedChapters = useMemo(() => {
    const ordered = descending ? [...chapters].reverse() : chapters;
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return ordered;
    return ordered.filter((c) => c.title.toLowerCase().includes(cleanQuery));
  }, [chapters, descending, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);

    requestAnimationFrame(() => {
      activeItemRef.current?.scrollIntoView({ block: 'center' });
      if (chapters.length > 10) {
        searchInputRef.current?.focus();
      }
    });

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, chapters.length]);

  return (
    <div ref={rootRef} data-no-stage-tap="true" className="relative">
      <button
        type="button"
        aria-label={labels.selectAria}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 max-w-[140px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-slate-100 transition hover:border-white/25 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--ky-accent-soft)] sm:max-w-[235px]"
      >
        <ListOrdered className="hidden h-3.5 w-3.5 shrink-0 text-[var(--ky-accent-text)] sm:block" />
        <span className="truncate">{activeChapter?.title ?? labels.selectAria}</span>
        {chapters.length > 0 && activeIndex >= 0 && (
          <span className="hidden shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 md:inline">
            {activeIndex + 1}/{chapters.length}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-[var(--ky-accent-text)]' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={labels.selectAria}
          className="ky-dropdown-panel fixed inset-x-3 top-14 z-50 flex max-h-[min(70dvh,480px)] flex-col overflow-hidden rounded-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(92vw,370px)]"
        >
          {/* En-tête du menu chapitres */}
          <div className="flex items-center gap-2 border-b border-[var(--ky-border)] p-2.5">
            {chapters.length > 8 ? (
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ky-text-soft)]" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={labels.searchPlaceholder}
                  className="ky-input w-full rounded-xl py-1.5 pl-8 pr-3 text-xs"
                />
              </div>
            ) : (
              <span className="flex-1 px-1 text-xs font-semibold text-[var(--ky-text-heading)]">
                {labels.selectAria} ({chapters.length})
              </span>
            )}

            <button
              type="button"
              title={labels.reverseOrder}
              onClick={() => setDescending((v) => !v)}
              className={`rounded-xl border px-2 py-1.5 text-xs transition ${
                descending
                  ? 'ky-pill-active border-transparent'
                  : 'border-[var(--ky-border)] bg-[var(--ky-surface-2)] text-[var(--ky-text-secondary)] hover:bg-[var(--ky-surface-hover)]'
              }`}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-[var(--ky-border)] bg-[var(--ky-surface-2)] p-1.5 text-[var(--ky-text-muted)] hover:text-[var(--ky-text-heading)] sm:hidden"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Liste scrollable bornée */}
          <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {displayedChapters.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--ky-text-soft)]">
                {labels.emptyMatch}
              </p>
            ) : (
              displayedChapters.map((c) => {
                const isActive = c.id === activeChapterId;
                const isOffline = offlineChapterIds?.has(c.id) ?? false;
                return (
                  <button
                    key={c.id}
                    ref={isActive ? activeItemRef : undefined}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) onSelect(c.id);
                    }}
                    className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-xs transition ${
                      isActive
                        ? 'ky-pill-active font-semibold'
                        : c.read
                          ? 'text-[var(--ky-text-soft)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text)]'
                          : 'text-[var(--ky-text)] hover:bg-[var(--ky-surface-hover)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{c.title}</p>
                      {c.lastPageRead > 0 && !c.read && (
                        <p className="mt-0.5 text-[10px] text-[var(--ky-accent-text)]">
                          {labels.pageProgress(c.lastPageRead + 1, c.totalPages)}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {c.isNew && !c.read && !isActive && (
                        <span className="ky-accent-badge rounded px-1.5 py-0.5 text-[9px] font-bold uppercase">
                          {labels.newBadge}
                        </span>
                      )}
                      {isOffline && (
                        <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                      {isActive && <Check className="h-3.5 w-3.5 text-[var(--ky-accent-text)]" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
