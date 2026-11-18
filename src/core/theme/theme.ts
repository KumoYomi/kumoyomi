import type { AccentPreset, ThemeMode } from '@/src/core/types/manga';

const THEME_STORAGE_KEY = 'kumoyomi:theme_mode';
const ACCENT_STORAGE_KEY = 'kumoyomi:accent_preset';

export interface ThemeMeta {
  id: ThemeMode;
  isLight: boolean;
  swatchBg: string;
  swatchCard: string;
  labelKey: 'theme.modeMidnight' | 'theme.modeObsidian' | 'theme.modeTwilight' | 'theme.modePaper';
}

export interface AccentMeta {
  id: AccentPreset;
  primary: string;
  secondary: string;
  labelKey:
    | 'theme.accentAurora'
    | 'theme.accentSakura'
    | 'theme.accentOcean'
    | 'theme.accentEmerald'
    | 'theme.accentAmber'
    | 'theme.accentViolet';
}

export const THEME_MODES: readonly ThemeMeta[] = [
  {
    id: 'midnight',
    isLight: false,
    swatchBg: '#0b0e17',
    swatchCard: '#14192b',
    labelKey: 'theme.modeMidnight',
  },
  {
    id: 'obsidian',
    isLight: false,
    swatchBg: '#06070a',
    swatchCard: '#11141c',
    labelKey: 'theme.modeObsidian',
  },
  {
    id: 'twilight',
    isLight: false,
    swatchBg: '#120e1e',
    swatchCard: '#1c162f',
    labelKey: 'theme.modeTwilight',
  },
  {
    id: 'paper',
    isLight: true,
    swatchBg: '#f4f1ea',
    swatchCard: '#ffffff',
    labelKey: 'theme.modePaper',
  },
] as const;

export const ACCENT_PRESETS: readonly AccentMeta[] = [
  {
    id: 'aurora',
    primary: '#6366f1',
    secondary: '#ec4899',
    labelKey: 'theme.accentAurora',
  },
  {
    id: 'ocean',
    primary: '#0ea5e9',
    secondary: '#06b6d4',
    labelKey: 'theme.accentOcean',
  },
  {
    id: 'emerald',
    primary: '#10b981',
    secondary: '#14b8a6',
    labelKey: 'theme.accentEmerald',
  },
  {
    id: 'violet',
    primary: '#8b5cf6',
    secondary: '#d946ef',
    labelKey: 'theme.accentViolet',
  },
  {
    id: 'sakura',
    primary: '#f43f5e',
    secondary: '#a855f7',
    labelKey: 'theme.accentSakura',
  },
  {
    id: 'amber',
    primary: '#f59e0b',
    secondary: '#f97316',
    labelKey: 'theme.accentAmber',
  },
] as const;

export function readCachedTheme(): { themeMode: ThemeMode; accentColor: AccentPreset } {
  let themeMode: ThemeMode = 'midnight';
  let accentColor: AccentPreset = 'aurora';
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    const a = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentPreset | null;
    if (t && THEME_MODES.some((m) => m.id === t)) themeMode = t;
    if (a && ACCENT_PRESETS.some((p) => p.id === a)) accentColor = a;
  } catch {
    // Ignore storage read errors outside browser storage
  }
  return { themeMode, accentColor };
}

/**
 * Applies surface theme and accent palette tokens to the root <html> element
 * and caches them locally to prevent flash of un-themed content.
 */
export function applyThemeToDocument(themeMode: ThemeMode = 'midnight', accentColor: AccentPreset = 'aurora'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isLight = themeMode === 'paper';

  root.dataset.theme = themeMode;
  root.dataset.accent = accentColor;
  root.style.colorScheme = isLight ? 'light' : 'dark';
  root.classList.toggle('dark', !isLight);
  root.classList.toggle('light', isLight);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
  } catch {
    // Ignore storage write errors
  }
}
