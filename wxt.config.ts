import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SUF obedník',
    description: 'Automaticky vyhľadá a zobrazí náhľadové fotografie jedál v školskom jedálnom lístku (Apetit / phpBox).',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: [
      'http://194.160.223.198/*',
      'https://194.160.223.198/*',
      '*://duckduckgo.com/*',
      '*://*.wikipedia.org/*',
      '*://*.wikimedia.org/*',
      '*://*.pravda.sk/*',
      '*://*.aktuality.sk/*',
    ],
  },
});
