import { getOrCreateSettings } from '@/src/core/db/db';
import {
  getLastCloudflareUnlockTime,
  isExtensionContext,
  requestCloudflareVerificationPopup,
} from '@/src/core/extension/browserBridge';
import { CloudflareChallengeError } from '@/src/core/parser/httpClient';

/**
 * Triggers the compact Cloudflare verification popup if enabled and the user has
 * not just manually dismissed it for this domain.
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
 * Executes a network task and automatically runs the Cloudflare/Captcha popup
 * when needed, retrying cleanly (with a brief stabilization retry) once unlocked.
 */
export async function runWithAutoCloudflarePopup<T>(task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await task();
  } catch (err) {
    if (err instanceof CloudflareChallengeError) {
      const unlocked = await tryAutoVerifyCloudflarePopup(err);
      const unlockedConcurrently = !unlocked && getLastCloudflareUnlockTime(err.url) >= startedAt;
      if (unlocked || unlockedConcurrently) {
        try {
          return await task();
        } catch {
          // Give moved/docked tabs a short settle window before one final retry
          await new Promise((r) => setTimeout(r, 500));
          return await task();
        }
      }
    }
    throw err;
  }
}
