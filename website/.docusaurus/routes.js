import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/iagate-querykit/__docusaurus/debug',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug', '96b'),
    exact: true
  },
  {
    path: '/iagate-querykit/__docusaurus/debug/config',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug/config', 'b1a'),
    exact: true
  },
  {
    path: '/iagate-querykit/__docusaurus/debug/content',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug/content', 'dd6'),
    exact: true
  },
  {
    path: '/iagate-querykit/__docusaurus/debug/globalData',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug/globalData', '75c'),
    exact: true
  },
  {
    path: '/iagate-querykit/__docusaurus/debug/metadata',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug/metadata', 'a1e'),
    exact: true
  },
  {
    path: '/iagate-querykit/__docusaurus/debug/registry',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug/registry', '22b'),
    exact: true
  },
  {
    path: '/iagate-querykit/__docusaurus/debug/routes',
    component: ComponentCreator('/iagate-querykit/__docusaurus/debug/routes', '3e8'),
    exact: true
  },
  {
    path: '/iagate-querykit/',
    component: ComponentCreator('/iagate-querykit/', 'c64'),
    routes: [
      {
        path: '/iagate-querykit/',
        component: ComponentCreator('/iagate-querykit/', '835'),
        routes: [
          {
            path: '/iagate-querykit/',
            component: ComponentCreator('/iagate-querykit/', 'cbf'),
            routes: [
              {
                path: '/iagate-querykit/adapters-and-executors',
                component: ComponentCreator('/iagate-querykit/adapters-and-executors', '3c3'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/api',
                component: ComponentCreator('/iagate-querykit/api', '142'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/config',
                component: ComponentCreator('/iagate-querykit/config', '98f'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/event-manager',
                component: ComponentCreator('/iagate-querykit/event-manager', '3e0'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/getting-started',
                component: ComponentCreator('/iagate-querykit/getting-started', '879'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/migrations',
                component: ComponentCreator('/iagate-querykit/migrations', 'c7d'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/models',
                component: ComponentCreator('/iagate-querykit/models', 'c94'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/multi-db',
                component: ComponentCreator('/iagate-querykit/multi-db', '7d1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/mysql',
                component: ComponentCreator('/iagate-querykit/mysql', '461'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/oracle',
                component: ComponentCreator('/iagate-querykit/oracle', 'ccb'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/parallel',
                component: ComponentCreator('/iagate-querykit/parallel', 'e31'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/postgresql',
                component: ComponentCreator('/iagate-querykit/postgresql', '918'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/query-builder',
                component: ComponentCreator('/iagate-querykit/query-builder', '0b7'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/raw-and-table',
                component: ComponentCreator('/iagate-querykit/raw-and-table', 'a83'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/scheduler',
                component: ComponentCreator('/iagate-querykit/scheduler', '6ee'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/simulation',
                component: ComponentCreator('/iagate-querykit/simulation', '5dc'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/sqlserver',
                component: ComponentCreator('/iagate-querykit/sqlserver', 'a6f'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/triggers-semantic',
                component: ComponentCreator('/iagate-querykit/triggers-semantic', '83b'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/triggers-sql',
                component: ComponentCreator('/iagate-querykit/triggers-sql', 'b51'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/views',
                component: ComponentCreator('/iagate-querykit/views', '337'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/',
                component: ComponentCreator('/iagate-querykit/', '43f'),
                exact: true,
                sidebar: "docs"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
