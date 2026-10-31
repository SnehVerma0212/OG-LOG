import type { RouteObject } from 'react-router';

import { AppShell } from './components/AppShell';
import { CaseDetailsPage } from './pages/CaseDetailsPage';
import { CaseEditorPage } from './pages/CaseEditorPage';
import { CasesPage } from './pages/CasesPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatisticsPage } from './pages/StatisticsPage';

// Case IDs appear in URLs; search terms and clinical details never do.
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'cases', element: <CasesPage /> },
      { path: 'cases/new', element: <CaseEditorPage key="new" /> },
      { path: 'cases/:caseId', element: <CaseDetailsPage /> },
      { path: 'cases/:caseId/edit', element: <CaseEditorPage /> },
      { path: 'statistics', element: <StatisticsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
