import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/iagate-querykit/es/',
    component: ComponentCreator('/iagate-querykit/es/', '2e4'),
    routes: [
      {
        path: '/iagate-querykit/es/',
        component: ComponentCreator('/iagate-querykit/es/', '9c3'),
        routes: [
          {
            path: '/iagate-querykit/es/',
            component: ComponentCreator('/iagate-querykit/es/', '7e4'),
            routes: [
              {
                path: '/iagate-querykit/es/adapters-and-executors',
                component: ComponentCreator('/iagate-querykit/es/adapters-and-executors', '6bc'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/api',
                component: ComponentCreator('/iagate-querykit/es/api', 'a10'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/config',
                component: ComponentCreator('/iagate-querykit/es/config', 'b4e'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/event-manager',
                component: ComponentCreator('/iagate-querykit/es/event-manager', '1c4'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/getting-started',
                component: ComponentCreator('/iagate-querykit/es/getting-started', '441'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/models',
                component: ComponentCreator('/iagate-querykit/es/models', 'aad'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/multi-db',
                component: ComponentCreator('/iagate-querykit/es/multi-db', '517'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/mysql',
                component: ComponentCreator('/iagate-querykit/es/mysql', 'd89'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/oracle',
                component: ComponentCreator('/iagate-querykit/es/oracle', '021'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/parallel',
                component: ComponentCreator('/iagate-querykit/es/parallel', '884'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/postgresql',
                component: ComponentCreator('/iagate-querykit/es/postgresql', '683'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/query-builder',
                component: ComponentCreator('/iagate-querykit/es/query-builder', '4ea'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/raw-and-table',
                component: ComponentCreator('/iagate-querykit/es/raw-and-table', '8df'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/scheduler',
                component: ComponentCreator('/iagate-querykit/es/scheduler', 'b70'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/simulation',
                component: ComponentCreator('/iagate-querykit/es/simulation', '7a6'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/sqlserver',
                component: ComponentCreator('/iagate-querykit/es/sqlserver', '65b'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/triggers-semantic',
                component: ComponentCreator('/iagate-querykit/es/triggers-semantic', '466'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/triggers-sql',
                component: ComponentCreator('/iagate-querykit/es/triggers-sql', 'dcf'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/views',
                component: ComponentCreator('/iagate-querykit/es/views', 'fc7'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/iagate-querykit/es/',
                component: ComponentCreator('/iagate-querykit/es/', 'e0d'),
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
