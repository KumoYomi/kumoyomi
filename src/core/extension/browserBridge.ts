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
  | { type: 'PROXY_FETCH_IN_TAB'; payload: TabProxyFetchRequest }
  | { type: 'CHECK_UPDATES_NOW' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'SET_UPDATE_ALARM'; intervalMinutes: number };

export interface UpdateCheckSummary {
  checkedMangas: number;
  newChaptersCount: number;
  errors: Array<{ mangaTitle: string; sourceId: string; message: string; isCloudflare?: boolean }>;
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

export async function requestOriginPermission(baseUrl: string): Promise<boolean> {
  const api = getApi();
  if (!api?.permissions) return true;
  try {
    const origin = new URL(baseUrl).origin;
    return await api.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
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
