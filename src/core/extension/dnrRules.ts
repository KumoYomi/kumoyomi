import { browser } from 'wxt/browser';

const SOURCE_RULE_ID_START = 10_000;
const IMAGE_RULE_ID_START = 20_000;
const CORS_RULE_ID_START = 30_000;
const SESSION_IMAGE_MAP_KEY = 'kumoyomi_dnr_image_hosts';
const SESSION_CORS_MAP_KEY = 'kumoyomi_dnr_cors_pairs';

const ensuredImageHostCache = new Map<string, string>();
const ensuredCorsPairCache = new Set<string>();

type DnrRule = Parameters<
  typeof browser.declarativeNetRequest.updateSessionRules
>[0]['addRules'] extends Array<infer R> | undefined
  ? R
  : never;

function getExtensionInitiatorDomain(): string | undefined {
  try {
    const extUrl = browser.runtime.getURL('/');
    const hostname = new URL(extUrl).hostname;
    return hostname || undefined;
  } catch {
    return undefined;
  }
}

async function applySessionRules(removeRuleIds: number[], addRules: DnrRule[]): Promise<void> {
  if (!browser.declarativeNetRequest?.updateSessionRules) return;
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules,
    });
  } catch (err) {
    console.warn('[KumoYomi DNR] Échec updateSessionRules, repli sur updateDynamicRules:', err);
    if (browser.declarativeNetRequest.updateDynamicRules) {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules,
      });
    }
  }
}

export async function syncSourceDnrRules(sources: Array<{ baseUrl: string }>): Promise<void> {
  if (!browser.declarativeNetRequest) return;

  const existing = await browser.declarativeNetRequest.getSessionRules();
  const removeIds = existing
    .filter((r) => r.id >= SOURCE_RULE_ID_START && r.id < IMAGE_RULE_ID_START)
    .map((r) => r.id);

  const initiator = getExtensionInitiatorDomain();
  const uniqueOrigins = new Map<string, string>();

  for (const src of sources) {
    try {
      const parsed = new URL(src.baseUrl);
      if (!uniqueOrigins.has(parsed.host)) {
        uniqueOrigins.set(parsed.host, parsed.origin);
      }
    } catch {
      // Ignore invalid URL
    }
  }

  const addRules: DnrRule[] = [];
  let idx = 0;

  for (const [host, origin] of uniqueOrigins.entries()) {
    addRules.push(
      {
        id: SOURCE_RULE_ID_START + idx * 2,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: `${origin}/` },
            { header: 'Origin', operation: 'remove' },
          ],
        },
        condition: {
          urlFilter: `||${host}/`,
          ...(initiator ? { initiatorDomains: [initiator] } : {}),
          requestMethods: ['get', 'head'],
          resourceTypes: ['xmlhttprequest', 'image', 'other'],
        },
      },
      {
        id: SOURCE_RULE_ID_START + idx * 2 + 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: `${origin}/` },
            { header: 'Origin', operation: 'set', value: origin },
          ],
        },
        condition: {
          urlFilter: `||${host}/`,
          ...(initiator ? { initiatorDomains: [initiator] } : {}),
          excludedRequestMethods: ['get', 'head'],
          resourceTypes: ['xmlhttprequest', 'image', 'other'],
        },
      },
    );
    idx += 1;
  }

  await applySessionRules(removeIds, addRules);
}

export async function ensureImageRefererDnrRule(
  imageUrl: string,
  refererOrigin: string,
): Promise<void> {
  if (!browser.declarativeNetRequest) return;

  let imageHost: string;
  let cleanRefererOrigin: string;
  try {
    imageHost = new URL(imageUrl).host;
    cleanRefererOrigin = new URL(refererOrigin).origin;
  } catch {
    return;
  }

  if (!imageHost || imageHost === new URL(cleanRefererOrigin).host) {
    return;
  }

  const normalizedHost = imageHost.toLowerCase();
  if (ensuredImageHostCache.get(normalizedHost) === cleanRefererOrigin) {
    return;
  }

  const storageArea = browser.storage.session ?? browser.storage.local;
  const stored = await storageArea.get(SESSION_IMAGE_MAP_KEY);
  const hostMap =
    (stored[SESSION_IMAGE_MAP_KEY] as Record<string, { id: number; referer: string }> | undefined) ??
    {};

  const existingEntry = hostMap[imageHost];
  if (existingEntry && existingEntry.referer === cleanRefererOrigin) {
    ensuredImageHostCache.set(normalizedHost, cleanRefererOrigin);
    return;
  }

  const usedIds = new Set(Object.values(hostMap).map((e) => e.id));
  let ruleId = existingEntry?.id ?? IMAGE_RULE_ID_START;
  if (!existingEntry) {
    while (usedIds.has(ruleId)) {
      ruleId += 1;
    }
  }

  const initiator = getExtensionInitiatorDomain();
  const rule: DnrRule = {
    id: ruleId,
    priority: 2,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: `${cleanRefererOrigin}/` },
        { header: 'Origin', operation: 'remove' },
      ],
    },
    condition: {
      urlFilter: `||${normalizedHost}/`,
      ...(initiator ? { initiatorDomains: [initiator] } : {}),
      resourceTypes: ['xmlhttprequest', 'image', 'other'],
    },
  };

  await applySessionRules([ruleId], [rule]);
  ensuredImageHostCache.set(normalizedHost, cleanRefererOrigin);
  hostMap[imageHost] = { id: ruleId, referer: cleanRefererOrigin };
  await storageArea.set({ [SESSION_IMAGE_MAP_KEY]: hostMap });
}

/**
 * Injecte Access-Control-Allow-Origin pour les requêtes fetch same-site (ex: CDN image en sous-domaine)
 * déclenchées depuis un onglet déjà ouvert et débloqué du domaine principal.
 */
export async function ensureCrossSubdomainCorsDnrRule(
  targetHost: string,
  tabOrigin: string,
): Promise<void> {
  if (!browser.declarativeNetRequest) return;

  let cleanTabOrigin: string;
  let tabHost: string;
  try {
    const u = new URL(tabOrigin);
    cleanTabOrigin = u.origin;
    tabHost = u.hostname.toLowerCase();
  } catch {
    return;
  }

  const cleanTargetHost = targetHost.toLowerCase();
  if (!cleanTargetHost || !tabHost || cleanTargetHost === tabHost) {
    return;
  }

  const pairKey = `${cleanTargetHost}::${cleanTabOrigin}`;
  if (ensuredCorsPairCache.has(pairKey)) {
    return;
  }

  const storageArea = browser.storage.session ?? browser.storage.local;
  const stored = await storageArea.get(SESSION_CORS_MAP_KEY);
  const pairMap = (stored[SESSION_CORS_MAP_KEY] as Record<string, number> | undefined) ?? {};

  if (pairMap[pairKey] !== undefined) {
    ensuredCorsPairCache.add(pairKey);
    return;
  }

  const usedIds = new Set(Object.values(pairMap));
  let ruleId = CORS_RULE_ID_START;
  while (usedIds.has(ruleId)) {
    ruleId += 1;
  }

  const rule: DnrRule = {
    id: ruleId,
    priority: 3,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: cleanTabOrigin },
        { header: 'Access-Control-Allow-Credentials', operation: 'set', value: 'true' },
        { header: 'Cross-Origin-Resource-Policy', operation: 'remove' },
      ],
    },
    condition: {
      urlFilter: `||${cleanTargetHost}/`,
      initiatorDomains: [tabHost],
      resourceTypes: ['xmlhttprequest'],
    },
  };

  await applySessionRules([ruleId], [rule]);
  ensuredCorsPairCache.add(pairKey);
  pairMap[pairKey] = ruleId;
  await storageArea.set({ [SESSION_CORS_MAP_KEY]: pairMap });
}
