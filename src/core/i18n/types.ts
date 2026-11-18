import type { en } from '@/src/core/i18n/locales/en';

export type TranslationKey = keyof typeof en;
export type TranslationDict = Record<TranslationKey, string>;
