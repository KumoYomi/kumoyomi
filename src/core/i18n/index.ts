import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect } from 'react';
import { db, detectBrowserLocale, getOrCreateSettings } from '@/src/core/db/db';
import { en } from '@/src/core/i18n/locales/en';
import { es } from '@/src/core/i18n/locales/es';
import { fr } from '@/src/core/i18n/locales/fr';
import { zh } from '@/src/core/i18n/locales/zh';
import type { TranslationDict, TranslationKey } from '@/src/core/i18n/types';
import type { AppLocale } from '@/src/core/types/manga';

const LOCALE_CACHE_KEY = 'kumoyomi:locale';

const DICTIONARIES: Record<AppLocale, TranslationDict> = {
  en,
  fr,
  es,
  zh,
};

export const LOCALE_OPTIONS: Array<{ value: AppLocale; label: string; nativeLabel: string }> = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'fr', label: 'Français', nativeLabel: 'Français' },
  { value: 'es', label: 'Español', nativeLabel: 'Español' },
  { value: 'zh', label: '中文 (简体)', nativeLabel: '中文' },
];

export const INTL_LOCALE_TAG: Record<AppLocale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  zh: 'zh-CN',
};

export function isSupportedLocale(value: unknown): value is AppLocale {
  return value === 'en' || value === 'fr' || value === 'es' || value === 'zh';
}

export function getCachedLocale(): AppLocale {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LOCALE_CACHE_KEY);
      if (isSupportedLocale(stored)) return stored;
    }
  } catch {
    // Ignore storage errors
  }
  return detectBrowserLocale();
}

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTIONARIES[locale] ?? en;
  let text = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{{${k}}}`).join(String(v));
    }
  }
  return text;
}

export async function setAppLocale(nextLocale: AppLocale): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCALE_CACHE_KEY, nextLocale);
    }
  } catch {
    // Ignore storage errors
  }
  const current = await getOrCreateSettings();
  await db.settings.put({ ...current, language: nextLocale });
}

export function useTranslation() {
  const settings = useLiveQuery(() => db.settings.get('default'), [], undefined);
  const locale: AppLocale = isSupportedLocale(settings?.language)
    ? settings.language
    : getCachedLocale();

  useEffect(() => {
    try {
      if (typeof document !== 'undefined') {
        document.documentElement.lang = locale;
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCALE_CACHE_KEY, locale);
      }
    } catch {
      // Ignore DOM/storage errors in tests
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  const formatDate = useCallback(
    (ts: number, options?: Intl.DateTimeFormatOptions) =>
      new Date(ts).toLocaleDateString(
        INTL_LOCALE_TAG[locale],
        options ?? { day: 'numeric', month: 'short' },
      ),
    [locale],
  );

  const formatTime = useCallback(
    (ts: number) =>
      new Date(ts).toLocaleTimeString(INTL_LOCALE_TAG[locale], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  return {
    locale,
    t,
    formatDate,
    formatTime,
    setLocale: setAppLocale,
  };
}
