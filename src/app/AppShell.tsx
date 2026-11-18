import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bell,
  BookMarked,
  Compass,
  FolderGit2,
  Search,
  Settings,
} from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { type AppRoute, buildHashUrl, navigate } from '@/src/app/router';
import { db } from '@/src/core/db/db';

interface AppShellProps {
  route: AppRoute;
  children: ReactNode;
}

export function AppShell({ route, children }: AppShellProps) {
  const favoritesCount =
    useLiveQuery(() => db.mangas.filter((m) => m.favorite).count(), [], 0) ?? 0;
  const newChaptersCount =
    useLiveQuery(() => db.chapters.filter((c) => c.isNew && !c.read).count(), [], 0) ?? 0;
  const enabledSourcesCount =
    useLiveQuery(() => db.sources.filter((s) => s.enabled).count(), [], 0) ?? 0;
  const settings = useLiveQuery(() => db.settings.get('default'), [], undefined);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate({ name: 'explore' });
        requestAnimationFrame(() => {
          const el = document.getElementById('global-search-input');
          el?.focus();
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (route.name === 'reader') {
    return <div className="min-h-screen bg-[#050507] text-zinc-100">{children}</div>;
  }

  const navItems: Array<{
    key: AppRoute['name'];
    label: string;
    icon: typeof BookMarked;
    badge?: number;
    href: string;
  }> = [
    {
      key: 'library',
      label: 'Bibliothèque',
      icon: BookMarked,
      badge: favoritesCount > 0 ? favoritesCount : undefined,
      href: buildHashUrl({ name: 'library' }),
    },
    {
      key: 'updates',
      label: 'Nouveautés',
      icon: Bell,
      badge: newChaptersCount > 0 ? newChaptersCount : undefined,
      href: buildHashUrl({ name: 'updates' }),
    },
    {
      key: 'explore',
      label: 'Explorer',
      icon: Compass,
      href: buildHashUrl({ name: 'explore' }),
    },
    {
      key: 'sources',
      label: 'Sources & Dépôts',
      icon: FolderGit2,
      badge: enabledSourcesCount > 0 ? enabledSourcesCount : undefined,
      href: buildHashUrl({ name: 'sources' }),
    },
    {
      key: 'settings',
      label: 'Paramètres',
      icon: Settings,
      href: buildHashUrl({ name: 'settings' }),
    },
  ];

  return (
    <div className="flex min-h-screen bg-[#09090d] text-zinc-100">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-[#0d0d13]">
        <div className="flex items-center gap-3 border-b border-zinc-800/70 px-5 py-5">
          <img
            src="/icon/48.png"
            alt="KumoYomi"
            className="h-9 w-9 rounded-xl shadow-lg shadow-rose-950/40"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">KumoYomi</span>
              <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                Local
              </span>
            </div>
            <p className="text-xs text-zinc-500">Agrégateur & Lecteur PC</p>
          </div>
        </div>

        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => {
              navigate({ name: 'explore' });
              requestAnimationFrame(() => {
                document.getElementById('global-search-input')?.focus();
              });
            }}
            className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <span className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              Rechercher un manga...
            </span>
            <kbd className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              Ctrl K
            </kbd>
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = route.name === item.key;
            return (
              <a
                key={item.key}
                href={item.href}
                className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-rose-500/15 text-rose-300 shadow-inner shadow-rose-500/5 ring-1 ring-rose-500/30'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 ${
                      isActive ? 'text-rose-400' : 'text-zinc-500 group-hover:text-zinc-300'
                    }`}
                  />
                  {item.label}
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                      item.key === 'updates'
                        ? 'bg-rose-500 text-white'
                        : isActive
                          ? 'bg-rose-500/20 text-rose-200'
                          : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>

        <div className="border-t border-zinc-800/70 p-4 text-xs text-zinc-500">
          <div className="flex items-center justify-between">
            <span>Sources actives</span>
            <span className="font-semibold text-zinc-300">{enabledSourcesCount}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Dernière vérif.</span>
            <span className="text-zinc-400">
              {settings?.lastGlobalUpdateCheck
                ? new Date(settings.lastGlobalUpdateCheck).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Jamais'}
            </span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-[1600px] px-8 py-7">{children}</div>
      </main>
    </div>
  );
}
