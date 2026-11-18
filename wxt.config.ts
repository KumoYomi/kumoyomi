import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

const isAmoListed = process.env.KUMOYOMI_AMO_LISTED === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'KumoYomi',
    short_name: 'KumoYomi',
    description:
      '100% local decentralized manga reader and aggregator powered by external JSON source repositories.',
    version: '0.4.0',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'Open KumoYomi',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    permissions: [
      'storage',
      'unlimitedStorage',
      'alarms',
      'notifications',
      'scripting',
      'tabs',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
    ],
    ...(isAmoListed
      ? { optional_host_permissions: ['http://*/*', 'https://*/*'] }
      : { host_permissions: ['http://*/*', 'https://*/*'] }),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'kumoyomi@kumoyomi.app',
              strict_min_version: '128.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
          },
        }
      : {}),
  }),
});
