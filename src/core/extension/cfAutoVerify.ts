import { getOrCreateSettings } from '@/src/core/db/db';
import {
  isExtensionContext,
  requestCloudflareVerificationPopup,
} from '@/src/core/extension/browserBridge';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';

/**
 * Déclenche la petite fenêtre de vérification Cloudflare si le paramètre est activé
 * et si l'utilisateur ne vient pas de la fermer manuellement sur ce domaine.
 */
export async function tryAutoVerifyCloudflarePopup(
  error: CloudflareChallengeError,
): Promise<boolean> {
  if (!isExtensionContext()) return false;
  const settings = await getOrCreateSettings();
  if (settings.autoOpenCloudflarePopup === false) {
    return false;
  }
  const result = await requestCloudflareVerificationPopup(error.url, {
    probeUrl: error.requestUrl ?? error.url,
    autoTriggered: true,
  });
  return result.unlocked;
}

/**
 * Exécute une opération réseau et ouvre automatiquement la fenêtre de vérification
 * Cloudflare/Captcha si une protection survient, puis relance l'opération dès déblocage.
 */
export async function runWithAutoCloudflarePopup<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (err instanceof CloudflareChallengeError && (await tryAutoVerifyCloudflarePopup(err))) {
      return await task();
    }
    throw err;
  }
}
