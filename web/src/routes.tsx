import type { RouteObject } from 'react-router';

import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell';
import { CaseDetailsPage } from './pages/CaseDetailsPage';
import { ConfirmLinkPage } from './pages/ConfirmLinkPage';
import { CaseEditorPage } from './pages/CaseEditorPage';
import { CasesPage } from './pages/CasesPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { MfaChallengePage } from './pages/MfaChallengePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatisticsPage } from './pages/StatisticsPage';

// Case IDs appear in URLs; search terms and clinical details never do.
// Everything except the sign-in, password and email-link screens requires a
// signed-in user who has replaced any initial password.
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  { path: '/auth/confirm', element: <ConfirmLinkPage /> },
  { path: '/verify-mfa', element: <MfaChallengePage /> },
  {
    element: <RequireAuth />,
    children: [
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
    ],
  },
];
