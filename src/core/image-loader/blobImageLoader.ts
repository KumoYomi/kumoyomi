import { db } from '@/src/core/db/db';
import {
  requestTabProxyFetch,
  sendBackgroundMessage,
} from '@/src/core/extension/browserBridge';
import { isCloudflareResponse } from '@/src/core/parser/httpClient';

const scopeUrls = new Map<string, Map<string, string>>();
const inflightRequests = new Map<string, Promise<string>>();
const ensuredRefererPairs = new Set<string>();
const preferredImageProxyHosts = new Map<string, number>();

const MAX_COVER_CACHE_ENTRIES = 160;
const IMAGE_PROXY_TTL_MS = 5 * 60 * 1000;

export function clearImageProxyCache(): void {
  preferredImageProxyHosts.clear();
}

function safeOrigin(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function decodeBase64ToBlob(base64: string, contentType?: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType || 'image/jpeg' });
}

async function tryFetchImageViaTab(imageUrl: string, refererUrl?: string): Promise<Blob | null> {
  const proxied = await requestTabProxyFetch({
    url: imageUrl,
    method: 'GET',
    responseMode: 'base64',
    fallbackTabOrigin: safeOrigin(refererUrl),
  });
  if (proxied?.foundTab && proxied.ok && proxied.bodyBase64) {
    return decodeBase64ToBlob(proxied.bodyBase64, proxied.headers?.['content-type']);
  }
  return null;
}

async function ensureReferer(imageUrl: string, refererUrl?: string): Promise<void> {
  if (!refererUrl) return;
  try {
    const imgHost = new URL(imageUrl).host;
    const refOrigin = new URL(refererUrl).origin;
    const key = `${imgHost}::${refOrigin}`;
    if (ensuredRefererPairs.has(key)) return;
    ensuredRefererPairs.add(key);
    await sendBackgroundMessage({
      type: 'ENSURE_IMAGE_REFERER',
      imageUrl,
      refererOrigin: refOrigin,
    });
  } catch {
    // Ignore invalid URLs
  }
}

function trackScopeUrl(scopeId: string, originalUrl: string, objectUrl: string): void {
  let map = scopeUrls.get(scopeId);
  if (!map) {
    map = new Map();
    scopeUrls.set(scopeId, map);
  }
  map.set(originalUrl, objectUrl);
}

async function trimCoverCacheIfNeeded(): Promise<void> {
  const count = await db.coverBlobs.count();
  if (count <= MAX_COVER_CACHE_ENTRIES) return;
  const excess = count - MAX_COVER_CACHE_ENTRIES;
  const oldest = await db.coverBlobs.orderBy('cachedAt').limit(excess).primaryKeys();
  if (oldest.length > 0) {
    await db.coverBlobs.bulkDelete(oldest);
  }
}

export async function fetchImageAsBlobUrl(
  imageUrl: string,
  refererUrl?: string,
  scopeId = 'covers',
): Promise<string> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    throw new Error("URL d'image vide.");
  }
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const existingInScope = scopeUrls.get(scopeId)?.get(trimmed);
  if (existingInScope) {
    return existingInScope;
  }

  const inflightKey = `${scopeId}::${trimmed}`;
  const existingInflight = inflightRequests.get(inflightKey);
  if (existingInflight) {
    return existingInflight;
  }

  const task = (async () => {
    try {
      if (scopeId === 'covers') {
        const cached = await db.coverBlobs.get(trimmed);
        if (cached?.blob) {
          const objectUrl = URL.createObjectURL(cached.blob);
          trackScopeUrl(scopeId, trimmed, objectUrl);
          return objectUrl;
        }
      }

      await ensureReferer(trimmed, refererUrl);

      const imgHost = safeHost(trimmed);
      const cachedProxyUntil = imgHost ? preferredImageProxyHosts.get(imgHost) : undefined;
      let blob: Blob | undefined;

      if (cachedProxyUntil && cachedProxyUntil > Date.now()) {
        const proxiedBlob = await tryFetchImageViaTab(trimmed, refererUrl);
        if (proxiedBlob) {
          preferredImageProxyHosts.set(imgHost, Date.now() + IMAGE_PROXY_TTL_MS);
          blob = proxiedBlob;
        } else {
          preferredImageProxyHosts.delete(imgHost);
        }
      }

      if (!blob) {
        const response = await fetch(trimmed, {
          credentials: 'include',
        });

        if (!response.ok) {
          let cfDetected = response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';
          if (
            !cfDetected &&
            (response.status === 403 || response.status === 503 || response.status === 429)
          ) {
            const errText = await response.text().catch(() => '');
            cfDetected = isCloudflareResponse(response.status, response.headers, errText);
          }
          if (cfDetected) {
            const proxiedBlob = await tryFetchImageViaTab(trimmed, refererUrl);
            if (proxiedBlob) {
              if (imgHost) {
                preferredImageProxyHosts.set(imgHost, Date.now() + IMAGE_PROXY_TTL_MS);
              }
              blob = proxiedBlob;
            }
          }
          if (!blob) {
            throw new Error(`HTTP ${response.status} sur l'image`);
          }
        } else {
          blob = await response.blob();
        }
      }

      if (!blob || blob.size === 0) {
        throw new Error('Image vide reçue');
      }

      if (scopeId === 'covers' && blob.size < 2_500_000) {
        try {
          await db.coverBlobs.put({
            url: trimmed,
            referer: refererUrl ?? '',
            mimeType: blob.type || 'image/jpeg',
            blob,
            cachedAt: Date.now(),
          });
          void trimCoverCacheIfNeeded();
        } catch {
          // Quota ou transaction ignorée pour le cache optionnel
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      trackScopeUrl(scopeId, trimmed, objectUrl);
      return objectUrl;
    } finally {
      inflightRequests.delete(inflightKey);
    }
  })();

  inflightRequests.set(inflightKey, task);
  return task;
}

export function revokeScopeBlobUrls(scopeId: string): void {
  const map = scopeUrls.get(scopeId);
  if (!map) return;
  for (const objectUrl of map.values()) {
    if (objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrl);
    }
  }
  scopeUrls.delete(scopeId);
}

export async function clearCoverBlobCache(): Promise<void> {
  revokeScopeBlobUrls('covers');
  await db.coverBlobs.clear();
}
