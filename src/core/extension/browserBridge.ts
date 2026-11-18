export interface TabProxyFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  responseMode?: 'text' | 'base64';
  timeoutMs?: number;
  /** Origine du site principal déjà ouvert (utile pour les sous-domaines CDN). */
  fallbackTabOrigin?: string;
}

export interface TabProxyFetchResult {
  foundTab: boolean;
  ok?: boolean;
  status?: number;
  statusText?: string;
  finalUrl?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyBase64?: string;
  error?: string;
}

export type BackgroundMessage =
  | { type: 'SYNC_SOURCE_RULES'; sources: Array<{ baseUrl: string }> }
  | { type: 'ENSURE_IMAGE_REFERER'; imageUrl: string; refererOrigin: string }
  | { type: 'ENSURE_API_REFERER_ORIGIN'; apiUrl: string; originUrl: string }
  | { type: 'PROXY_FETCH_IN_TAB'; payload: TabProxyFetchRequest }
  | { type: 'CHECK_UPDATES_NOW' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'SET_UPDATE_ALARM'; intervalMinutes: number }
  | { type: 'CLEAR_CF_PROXY_TABS' }
  | { type: 'OPEN_EXTENSION_APP'; hash?: string };

export interface UpdateCheckSummary {
  checkedMangas: number;
  newChaptersCount: number;
  errors: Array<{
    mangaTitle: string;
    sourceId: string;
    message: string;
    isCloudflare?: boolean;
    probeUrl?: string;
  }>;
}

interface ExtensionRuntimeLike {
  runtime?: {
    id?: string;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
  };
  tabs?: {
    query?: (queryInfo: Record<string, unknown>) => Promise<unknown[]>;
    create(opts: { url: string; active?: boolean }): Promise<unknown>;
  };
  scripting?: {
    executeScript?: (opts: unknown) => Promise<unknown[]>;
  };
  permissions?: {
    contains(perms: { origins?: string[] }): Promise<boolean>;
    request(perms: { origins?: string[] }): Promise<boolean>;
  };
}

function getApi(): ExtensionRuntimeLike | null {
  const g = globalThis as unknown as {
    browser?: ExtensionRuntimeLike;
    chrome?: ExtensionRuntimeLike;
  };
  if (g.browser?.runtime?.id) return g.browser;
  if (g.chrome?.runtime?.id) return g.chrome;
  return null;
}

export function isExtensionContext(): boolean {
  return getApi() !== null;
}

export async function sendBackgroundMessage<T = unknown>(
  message: BackgroundMessage,
): Promise<T | undefined> {
  const api = getApi();
  if (!api?.runtime) return undefined;
  try {
    return (await api.runtime.sendMessage(message)) as T;
  } catch {
    return undefined;
  }
}

export async function checkGlobalOriginPermission(): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return true;
  try {
    return await api.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
  } catch {
    return true;
  }
}

export function requestGlobalOriginPermission(): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return Promise.resolve(true);
  try {
    return api.permissions
      .request({ origins: ['https://*/*', 'http://*/*'] })
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export async function checkOriginPermission(baseUrl: string): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return true;
  try {
    const origin = new URL(baseUrl).origin;
    return await api.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return true;
  }
}

export function requestOriginPermission(baseUrl: string): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return Promise.resolve(true);
  try {
    const parsed = new URL(baseUrl);
    const root = getSiteRootDomain(parsed.hostname);
    const includeSubdomains =
      root.includes('.') &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) &&
      parsed.hostname !== 'localhost';
    const origins = [
      `${parsed.origin}/*`,
      ...(includeSubdomains ? [`https://*.${root}/*`, `http://*.${root}/*`] : []),
    ];
    return api.permissions.request({ origins }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function requestRepositoryOriginPermission(rawUrl: string): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return Promise.resolve(true);
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed) return Promise.resolve(false);
    const origins = trimmed.includes('github.com')
      ? [
          'https://raw.githubusercontent.com/*',
          'https://api.github.com/*',
          'https://github.com/*',
        ]
      : [`${new URL(trimmed).origin}/*`];
    return api.permissions.request({ origins }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function requestBatchOriginPermissions(rawUrls: string[]): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return Promise.resolve(true);
  const origins = new Set<string>([
    'https://api.github.com/*',
    'https://raw.githubusercontent.com/*',
  ]);
  for (const rawUrl of rawUrls) {
    try {
      const parsed = new URL(rawUrl);
      origins.add(`${parsed.origin}/*`);
      const root = getSiteRootDomain(parsed.hostname);
      if (root.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) {
        origins.add(`https://*.${root}/*`);
      }
    } catch {
      // Ignore malformed origin
    }
  }
  return api.permissions.request({ origins: Array.from(origins) }).catch(() => false);
}

export interface CloudflarePopupResult {
  unlocked: boolean;
  cancelled?: boolean;
  mode?: 'direct' | 'hidden_tab' | 'pinned_tab' | 'minimized' | 'external_tab';
}

export async function requestCloudflareVerificationPopup(
  siteUrl: string,
  options?: { probeUrl?: string; autoTriggered?: boolean },
): Promise<CloudflarePopupResult> {
  const api = getApi();
  if (api !== null) {
    try {
      const { openCloudflareVerificationPopup } = await import('@/src/core/extension/cfPopup');
      return await openCloudflareVerificationPopup(siteUrl, options);
    } catch {
      // Repli sur l'ouverture d'onglet si le module fenêtre est indisponible
    }
  }
  await openExternalTab(siteUrl);
  return { unlocked: false, mode: 'external_tab' };
}

export async function openExternalTab(url: string): Promise<void> {
  const api = getApi();
  if (api?.tabs) {
    await api.tabs.create({ url, active: true });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

type InProcessTabProxyHandler = (
  request: TabProxyFetchRequest,
) => Promise<TabProxyFetchResult>;

let inProcessTabProxyHandler: InProcessTabProxyHandler | null = null;

/** Permet au worker d'arrière-plan d'exécuter le proxy onglet sans passer par runtime.sendMessage. */
export function registerInProcessTabProxyHandler(
  handler: InProcessTabProxyHandler | null,
): void {
  inProcessTabProxyHandler = handler;
}

const MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'co.jp',
  'ne.jp',
  'com.au',
  'com.br',
  'com.mx',
  'com.tr',
  'co.kr',
]);

export function getSiteRootDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

const TAB_PROXY_STORAGE_KEY = 'kumoyomi:tab_proxied_domains';
const TAB_PROXY_PERSIST_KEY = 'kumoyomi:tab_proxied_domains_persist';

function readDomainList(storage: Storage | undefined, key: string): string[] {
  try {
    if (!storage) return [];
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function loadPersistedTabProxiedDomains(): Set<string> {
  const sessionList = readDomainList(
    typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
    TAB_PROXY_STORAGE_KEY,
  );
  const localList = readDomainList(
    typeof localStorage !== 'undefined' ? localStorage : undefined,
    TAB_PROXY_PERSIST_KEY,
  );
  return new Set([...sessionList, ...localList]);
}

function writeDomainList(storage: Storage | undefined, key: string, values: string[]): void {
  try {
    if (!storage) return;
    if (values.length === 0) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, JSON.stringify(values));
    }
  } catch {
    // Ignore storage errors in restricted contexts or private mode.
  }
}

function persistTabProxiedDomains(domains: Set<string>): void {
  const arr = [...domains];
  writeDomainList(
    typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
    TAB_PROXY_STORAGE_KEY,
    arr,
  );
  writeDomainList(
    typeof localStorage !== 'undefined' ? localStorage : undefined,
    TAB_PROXY_PERSIST_KEY,
    arr,
  );
}

const tabProxiedRootDomains = loadPersistedTabProxiedDomains();
const lastUnlockedAtByRoot = new Map<string, number>();
const cfUnlockListeners = new Set<(rootDomain: string) => void>();

function extractSiteRootFromUrl(rawUrl: string): string | null {
  try {
    return getSiteRootDomain(new URL(rawUrl).hostname);
  } catch {
    return null;
  }
}

export function markSiteTabProxied(rawUrl: string): void {
  const root = extractSiteRootFromUrl(rawUrl);
  if (root && !tabProxiedRootDomains.has(root)) {
    tabProxiedRootDomains.add(root);
    persistTabProxiedDomains(tabProxiedRootDomains);
  }
}

export function clearSiteTabProxied(rawUrl: string): void {
  const root = extractSiteRootFromUrl(rawUrl);
  if (root && tabProxiedRootDomains.delete(root)) {
    persistTabProxiedDomains(tabProxiedRootDomains);
  }
}

export function isSiteTabProxied(rawUrl: string): boolean {
  const root = extractSiteRootFromUrl(rawUrl);
  return Boolean(root && tabProxiedRootDomains.has(root));
}

export function notifyCloudflareDomainUnlocked(rawUrl: string): void {
  const root = extractSiteRootFromUrl(rawUrl);
  if (!root) return;
  lastUnlockedAtByRoot.set(root, Date.now());
  for (const listener of Array.from(cfUnlockListeners)) {
    try {
      listener(root);
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function getLastCloudflareUnlockTime(rawUrl: string): number {
  const root = extractSiteRootFromUrl(rawUrl);
  if (!root) return 0;
  return lastUnlockedAtByRoot.get(root) ?? 0;
}

export function onCloudflareDomainUnlocked(rawUrl: string, cb: () => void): () => void {
  const expectedRoot = extractSiteRootFromUrl(rawUrl);
  if (!expectedRoot) return () => {};
  const listener = (unlockedRoot: string) => {
    if (unlockedRoot === expectedRoot) {
      cb();
    }
  };
  cfUnlockListeners.add(listener);
  return () => {
    cfUnlockListeners.delete(listener);
  };
}

export function clearAllSiteTabProxyHints(): void {
  tabProxiedRootDomains.clear();
  lastUnlockedAtByRoot.clear();
  persistTabProxiedDomains(tabProxiedRootDomains);
}

export async function requestTabProxyFetch(
  request: TabProxyFetchRequest,
): Promise<TabProxyFetchResult | undefined> {
  if (inProcessTabProxyHandler) {
    return inProcessTabProxyHandler(request);
  }
  const api = getApi();
  if (api?.tabs?.query && api?.scripting?.executeScript) {
    try {
      const { proxyFetchInOpenTab } = await import('@/src/core/extension/tabProxy');
      return await proxyFetchInOpenTab(request);
    } catch {
      // Repli sur sendBackgroundMessage si l'appel direct échoue
    }
  }
  if (api !== null) {
    return sendBackgroundMessage<TabProxyFetchResult>({
      type: 'PROXY_FETCH_IN_TAB',
      payload: request,
    });
  }
  return undefined;
}
