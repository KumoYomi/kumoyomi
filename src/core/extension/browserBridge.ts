export type BackgroundMessage =
  | { type: 'SYNC_SOURCE_RULES'; sources: Array<{ baseUrl: string }> }
  | { type: 'ENSURE_IMAGE_REFERER'; imageUrl: string; refererOrigin: string }
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
    create(opts: { url: string; active?: boolean }): Promise<unknown>;
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
