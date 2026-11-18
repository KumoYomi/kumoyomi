import { browser } from 'wxt/browser';

export default defineContentScript({
  matches: ['https://kumoyomi.github.io/*'],
  runAt: 'document_idle',
  main() {
    const version = browser.runtime.getManifest?.().version ?? '0.4.2';

    try {
      document.documentElement.dataset.kumoyomiInstalled = version;
      window.dispatchEvent(new CustomEvent('kumoyomi:ready', { detail: { version } }));
    } catch {
      // Ignore DOM signal errors on restricted documents
    }

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; routeHash?: unknown } | undefined;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'KUMOYOMI_PING') {
        window.postMessage({ type: 'KUMOYOMI_PONG', version }, window.location.origin);
        return;
      }

      if (data.type === 'KUMOYOMI_LAUNCH') {
        const rawHash = typeof data.routeHash === 'string' ? data.routeHash : '';
        const safeHash = rawHash.startsWith('#/') ? rawHash : '';
        void browser.runtime
          .sendMessage({ type: 'OPEN_EXTENSION_APP', hash: safeHash })
          .then(() => {
            window.postMessage({ type: 'KUMOYOMI_LAUNCHED', ok: true }, window.location.origin);
          })
          .catch(() => {
            window.postMessage({ type: 'KUMOYOMI_LAUNCHED', ok: false }, window.location.origin);
          });
      }
    });
  },
});
