/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Core',
      collapsed: false,
      items: [
        'query-builder',
        'raw-and-table',
        'models',
        'config',
        'event-manager',
        'migrations',
      ],
    },
    {
      type: 'category',
      label: 'Database',
      collapsed: false,
      items: [
        'adapters-and-executors',
        'multi-db',
        'mysql',
        'postgresql',
        'oracle',
        'sqlserver',
      ],
    },
    {
      type: 'category',
      label: 'Views & Triggers',
      collapsed: false,
      items: [
        'views',
        'triggers-sql',
        'triggers-semantic',
      ],
    },
    'scheduler',
    'parallel',
    'simulation',
    {
      type: 'category',
      label: 'API Reference',
      collapsed: false,
      items: [
        'api'
      ],
    },
  ],
}; 