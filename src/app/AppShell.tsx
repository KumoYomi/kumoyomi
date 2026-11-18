import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bell,
  BookMarked,
  Compass,
  FolderGit2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type AppRoute, buildHashUrl, navigate } from '@/src/app/router';
import { db } from '@/src/core/db/db';
import {
  checkGlobalOriginPermission,
  isExtensionContext,
  requestGlobalOriginPermission,
} from '@/src/core/extension/browserBridge';
import { LOCALE_OPTIONS, useTranslation } from '@/src/core/i18n';
import { syncAllSourceRulesToBackground } from '@/src/core/parser/repositoryService';
import type { AppLocale } from '@/src/core/types/manga';

const SIDEBAR_COLLAPSE_KEY = 'kumoyomi:sidebar_collapsed';

function readExtensionVersion(): string {
  try {
    const g = globalThis as unknown as {
      browser?: { runtime?: { getManifest?: () => { version?: string } } };
      chrome?: { runtime?: { getManifest?: () => { version?: string } } };
    };
    return (
      g.browser?.runtime?.getManifest?.().version ??
      g.chrome?.runtime?.getManifest?.().version ??
      '0.4.0'
    );
  } catch {
    return '0.4.0';
  }
}

interface AppShellProps {
  route: AppRoute;
  children: ReactNode;
}

export function AppShell({ route, children }: AppShellProps) {
  const { locale, t, formatTime, setLocale } = useTranslation();
  const favoritesCount =
    useLiveQuery(() => db.mangas.filter((m) => m.favorite).count(), [], 0) ?? 0;
  const newChaptersCount =
    useLiveQuery(() => db.chapters.filter((c) => c.isNew && !c.read).count(), [], 0) ?? 0;
  const enabledSourcesCount =
    useLiveQuery(() => db.sources.filter((s) => s.enabled).count(), [], 0) ?? 0;
  const settings = useLiveQuery(() => db.settings.get('default'), [], undefined);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hasGlobalPerm, setHasGlobalPerm] = useState(true);

  useEffect(() => {
    if (!isExtensionContext()) return;
    let active = true;
    void checkGlobalOriginPermission().then((ok) => {
      if (active) setHasGlobalPerm(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [route.name]);

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
      label: t('nav.library'),
      icon: BookMarked,
      badge: favoritesCount > 0 ? favoritesCount : undefined,
      href: buildHashUrl({ name: 'library' }),
    },
    {
      key: 'updates',
      label: t('nav.updates'),
      icon: Bell,
      badge: newChaptersCount > 0 ? newChaptersCount : undefined,
      href: buildHashUrl({ name: 'updates' }),
    },
    {
      key: 'explore',
      label: t('nav.explore'),
      icon: Compass,
      href: buildHashUrl({ name: 'explore' }),
    },
    {
      key: 'sources',
      label: t('nav.sources'),
      icon: FolderGit2,
      badge: enabledSourcesCount > 0 ? enabledSourcesCount : undefined,
      href: buildHashUrl({ name: 'sources' }),
    },
    {
      key: 'settings',
      label: t('nav.settings'),
      icon: Settings,
      href: buildHashUrl({ name: 'settings' }),
    },
  ];

  const extVersion = readExtensionVersion();

  const sidebarContent = (isMobileDrawer: boolean) => (
    <>
      <div
        className={`flex items-center justify-between border-b border-zinc-800/70 ${
          collapsed && !isMobileDrawer ? 'px-3 py-4' : 'px-5 py-5'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/icon/48.png"
            alt="KumoYomi"
            className="h-9 w-9 shrink-0 rounded-xl shadow-lg shadow-rose-950/40"
          />
          {(!collapsed || isMobileDrawer) && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">KumoYomi</span>
                <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                  {t('shell.localBadge')}
                </span>
              </div>
              <p className="truncate text-xs text-zinc-500">{t('shell.subtitle')}</p>
            </div>
          )}
        </div>

        {isMobileDrawer ? (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            aria-label={t('shell.closeMenu')}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
            className="hidden rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 lg:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      <div className={collapsed && !isMobileDrawer ? 'px-2.5 pt-4' : 'px-4 pt-4'}>
        <button
          type="button"
          onClick={() => {
            navigate({ name: 'explore' });
            requestAnimationFrame(() => {
              document.getElementById('global-search-input')?.focus();
            });
          }}
          title={t('shell.searchTooltip')}
          className={`flex w-full items-center rounded-xl border border-zinc-800 bg-zinc-900/70 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200 ${
            collapsed && !isMobileDrawer ? 'justify-center px-2' : 'justify-between px-3'
          }`}
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            {(!collapsed || isMobileDrawer) && t('shell.searchPlaceholder')}
          </span>
          {(!collapsed || isMobileDrawer) && (
            <kbd className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              Ctrl K
            </kbd>
          )}
        </button>
      </div>

      <nav className={`flex-1 space-y-1 py-4 ${collapsed && !isMobileDrawer ? 'px-2' : 'px-3'}`}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = route.name === item.key;
          return (
            <a
              key={item.key}
              href={item.href}
              title={collapsed && !isMobileDrawer ? item.label : undefined}
              className={`group flex items-center rounded-xl py-2.5 text-sm font-medium transition ${
                collapsed && !isMobileDrawer ? 'justify-center px-2' : 'justify-between px-3'
              } ${
                isActive
                  ? 'bg-rose-500/15 text-rose-300 shadow-inner shadow-rose-500/5 ring-1 ring-rose-500/30'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-rose-400' : 'text-zinc-500 group-hover:text-zinc-300'
                  }`}
                />
                {(!collapsed || isMobileDrawer) && item.label}
              </span>
              {(!collapsed || isMobileDrawer) && item.badge !== undefined && (
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

      {(!collapsed || isMobileDrawer) && (
        <div className="space-y-2 border-t border-zinc-800/70 p-4 text-xs text-zinc-500">
          <div className="flex items-center justify-between">
            <span>{t('shell.activeSources')}</span>
            <span className="font-semibold text-zinc-300">{enabledSourcesCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('shell.lastCheck')}</span>
            <span className="text-zinc-400">
              {settings?.lastGlobalUpdateCheck
                ? formatTime(settings.lastGlobalUpdateCheck)
                : t('shell.never')}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span>{t('shell.languageLabel')}</span>
            <select
              aria-label={t('settings.languageLabel')}
              value={locale}
              onChange={(e) => void setLocale(e.target.value as AppLocale)}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-200 focus:border-rose-500 focus:outline-none"
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.nativeLabel}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('shell.version')}</span>
            <span className="font-mono text-[11px] text-zinc-400">v{extVersion}</span>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#09090d] text-zinc-100 lg:flex-row">
      {/* En-tête mobile / fenêtre étroite */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800/80 bg-[#0d0d13]/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-200 hover:bg-zinc-800"
            aria-label={t('shell.openMenu')}
          >
            <Menu className="h-4 w-4" />
          </button>
          <img src="/icon/32.png" alt="KumoYomi" className="h-6 w-6 rounded-lg" />
          <span className="text-sm font-bold text-white">KumoYomi</span>
        </div>
        {newChaptersCount > 0 && (
          <button
            type="button"
            onClick={() => navigate({ name: 'updates' })}
            className="rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white"
          >
            {t('shell.newCount', { count: newChaptersCount })}
          </button>
        )}
      </header>

      {/* Tiroir mobile */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-72 flex-col border-r border-zinc-800/80 bg-[#0d0d13]">
            {sidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Barre latérale desktop */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-zinc-800/80 bg-[#0d0d13] transition-all duration-200 lg:flex ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent(false)}
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-8 sm:py-7">
          {!hasGlobalPerm && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <p className="font-semibold text-amber-200">{t('shell.permBannerTitle')}</p>
                  <p className="mt-0.5 text-amber-200/80">{t('shell.permBannerDesc')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void requestGlobalOriginPermission().then((granted) => {
                    if (granted) {
                      setHasGlobalPerm(true);
                      void syncAllSourceRulesToBackground();
                    }
                  });
                }}
                className="shrink-0 rounded-xl bg-amber-500 px-3.5 py-2 font-semibold text-zinc-950 transition hover:bg-amber-400"
              >
                {t('shell.permGrantBtn')}
              </button>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
