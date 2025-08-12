// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'QueryKit',
  tagline: 'Minimal, typed building blocks for SQL-centric data apps in TypeScript',
  url: 'https://felipeoliveiradev.github.io',
  baseUrl: '/iagate-querykit/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'felipeoliveiradev',
  projectName: 'iagate-querykit',
  i18n: {
    defaultLocale: 'pt',
    locales: ['pt', 'en', 'es'],
    localeConfigs: {
      pt: { label: 'Português' },
      en: { label: 'English' },
      es: { label: 'Español' },
    },
  },
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],
  themeConfig: {
    navbar: {
      items: [
        { type: 'localeDropdown', position: 'right' },
      ],
    },
  },
};

module.exports = config; 