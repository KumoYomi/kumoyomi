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
import { CustomSelect } from '@/src/components/CustomSelect';
import { db } from '@/src/core/db/db';
import {
  checkGlobalOriginPermission,
  isExtensionContext,
  requestGlobalOriginPermission,
} from '@/src/core/extension/browserBridge';
import { LOCALE_OPTIONS, useTranslation } from '@/src/core/i18n';
import { syncAllSourceRulesToBackground } from '@/src/core/parser/repositoryService';
import { applyThemeToDocument } from '@/src/core/theme/theme';
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
      '0.4.2'
    );
  } catch {
    return '0.4.2';
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
    if (!settings) return;
    applyThemeToDocument(settings.themeMode ?? 'midnight', settings.accentColor ?? 'aurora');
  }, [settings?.themeMode, settings?.accentColor]);

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
    return (
      <div className="min-h-dvh bg-[var(--ky-reader-bg)] text-slate-100">{children}</div>
    );
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
        className={`flex items-center justify-between border-b border-[var(--ky-border)] ${
          collapsed && !isMobileDrawer ? 'px-3 py-4' : 'px-5 py-5'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/icon/48.png"
            alt="KumoYomi"
            className="h-9 w-9 shrink-0 rounded-xl shadow-lg shadow-indigo-950/40 ring-1 ring-white/10"
          />
          {(!collapsed || isMobileDrawer) && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="ky-heading text-base font-bold tracking-tight">KumoYomi</span>
                <span className="ky-pill-active rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  {t('shell.localBadge')}
                </span>
              </div>
              <p className="ky-soft truncate text-xs">{t('shell.subtitle')}</p>
            </div>
          )}
        </div>

        {isMobileDrawer ? (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="ky-muted rounded-lg p-1.5 hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)]"
            aria-label={t('shell.closeMenu')}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
            className="ky-soft hidden rounded-lg p-1.5 transition hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)] lg:inline-flex"
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
          className={`flex w-full items-center rounded-xl border border-[var(--ky-border)] bg-[var(--ky-surface-2)] py-2 text-xs text-[var(--ky-text-muted)] transition hover:border-[var(--ky-border-strong)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)] ${
            collapsed && !isMobileDrawer ? 'justify-center px-2' : 'justify-between px-3'
          }`}
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-[var(--ky-accent-text)]" />
            {(!collapsed || isMobileDrawer) && t('shell.searchPlaceholder')}
          </span>
          {(!collapsed || isMobileDrawer) && (
            <kbd className="rounded border border-[var(--ky-border)] bg-[var(--ky-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ky-text-muted)]">
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
                  ? 'ky-pill-active font-semibold'
                  : 'text-[var(--ky-text-muted)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)]'
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive
                      ? 'text-[var(--ky-accent-text)]'
                      : 'text-[var(--ky-text-soft)] group-hover:text-[var(--ky-text)]'
                  }`}
                />
                {(!collapsed || isMobileDrawer) && item.label}
              </span>
              {(!collapsed || isMobileDrawer) && item.badge !== undefined && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    item.key === 'updates'
                      ? 'ky-accent-badge'
                      : isActive
                        ? 'bg-[var(--ky-accent-soft)] text-[var(--ky-accent-text)]'
                        : 'bg-[var(--ky-surface-2)] text-[var(--ky-text-muted)]'
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
        <div className="space-y-2 border-t border-[var(--ky-border)] p-4 text-xs text-[var(--ky-text-muted)]">
          <div className="flex items-center justify-between">
            <span>{t('shell.activeSources')}</span>
            <span className="font-semibold text-sky-400">{enabledSourcesCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('shell.lastCheck')}</span>
            <span>
              {settings?.lastGlobalUpdateCheck
                ? formatTime(settings.lastGlobalUpdateCheck)
                : t('shell.never')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span>{t('shell.languageLabel')}</span>
            <CustomSelect
              ariaLabel={t('settings.languageLabel')}
              size="xs"
              align="right"
              value={locale}
              options={LOCALE_OPTIONS.map((opt) => ({
                value: opt.value as AppLocale,
                label: opt.nativeLabel,
              }))}
              onChange={(val) => void setLocale(val)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>{t('shell.version')}</span>
            <span className="font-mono text-[11px] text-[var(--ky-text-soft)]">v{extVersion}</span>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="ky-app-shell flex min-h-dvh flex-col lg:flex-row">
      {/* En-tête mobile / fenêtre étroite */}
      <header className="ky-sidebar sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-3.5 py-2.5 backdrop-blur-md lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="ky-btn-secondary rounded-xl p-2"
            aria-label={t('shell.openMenu')}
          >
            <Menu className="h-4 w-4" />
          </button>
          <img src="/icon/32.png" alt="KumoYomi" className="h-6 w-6 rounded-lg" />
          <span className="ky-heading truncate text-sm font-bold">KumoYomi</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              navigate({ name: 'explore' });
              requestAnimationFrame(() => {
                document.getElementById('global-search-input')?.focus();
              });
            }}
            aria-label={t('common.search')}
            className="ky-btn-secondary rounded-xl p-2"
          >
            <Search className="h-4 w-4" />
          </button>
          {newChaptersCount > 0 && (
            <button
              type="button"
              onClick={() => navigate({ name: 'updates' })}
              className="ky-accent-badge rounded-full px-2.5 py-1 text-xs font-semibold"
            >
              {t('shell.newCount', { count: newChaptersCount })}
            </button>
          )}
        </div>
      </header>

      {/* Tiroir mobile */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="ky-sidebar relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r">
            {sidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Barre latérale desktop */}
      <aside
        className={`ky-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-all duration-200 lg:flex ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent(false)}
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden pb-20 lg:pb-0">
        <div className="mx-auto max-w-[1600px] px-3.5 py-4 sm:px-8 sm:py-7">
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

      {/* Barre de navigation inférieure mobile / tablette */}
      <nav
        aria-label="Primary navigation"
        className="ky-sidebar fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t px-1 py-1.5 backdrop-blur-lg lg:hidden"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = route.name === item.key;
          return (
            <a
              key={item.key}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition ${
                isActive
                  ? 'ky-pill-active font-semibold'
                  : 'text-[var(--ky-text-muted)] hover:text-[var(--ky-text-heading)]'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-[var(--ky-accent-text)]' : ''}`} />
              <span className="max-w-full truncate px-1">{item.label}</span>
              {item.key === 'updates' && newChaptersCount > 0 && (
                <span className="ky-accent-badge absolute right-2 top-0.5 min-w-[16px] rounded-full px-1 text-center text-[9px] font-bold leading-4">
                  {newChaptersCount > 99 ? '99+' : newChaptersCount}
                </span>
              )}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
