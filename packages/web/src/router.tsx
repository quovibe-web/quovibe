import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { PortfolioLayout } from '@/layouts/PortfolioLayout';
import { UserSettingsLayout } from '@/layouts/UserSettingsLayout';
import { ErrorFallback } from '@/components/shared/ErrorFallback';
import { RootRedirect } from '@/components/shared/RootRedirect';
import { appendSearch } from '@/lib/router-helpers';

const AccountsHub = lazy(() => import('./pages/AccountsHub'));
const Watchlists = lazy(() => import('./pages/Watchlists'));
import Dashboard from '@/pages/Dashboard';
import Investments from '@/pages/Investments';
import SecurityDetail from '@/pages/SecurityDetail';
import Transactions from '@/pages/Transactions';
import TransactionNew from '@/pages/TransactionNew';
import AccountDetail from '@/pages/AccountDetail';
import Calculation from '@/pages/Calculation';
import PerformanceChart from '@/pages/PerformanceChart';
import AssetAllocation from '@/pages/AssetAllocation';
import Payments from '@/pages/Payments';
import UserSettings from '@/pages/UserSettings';
import PortfolioSettings from '@/pages/PortfolioSettings';
import TaxonomySeries from '@/pages/TaxonomySeries';
import CsvImportPage from '@/pages/CsvImportPage';
import Analytics from '@/pages/Analytics';
import Welcome from '@/pages/Welcome';
import ImportHub from '@/pages/ImportHub';

/**
 * URL-alias redirect that preserves `location.search`. Use this instead of
 * plain Navigate for every alias (an in-app URL that rewrites to another
 * in-app URL). Error redirects (invalid state → /welcome) keep plain Navigate.
 * See `.claude/rules/frontend.md` → "Routing / Redirects".
 */
function RedirectWithSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={appendSearch(to, search)} replace />;
}

function RedirectSecurityDetail() {
  const { id, portfolioId } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/p/${portfolioId}/investments/${id}${search}`} replace />;
}

function RedirectPerfSecurities() {
  const { portfolioId } = useParams();
  const [searchParams] = useSearchParams();
  const target = new URLSearchParams(searchParams);
  target.set('view', 'performance');
  return <Navigate to={`/p/${portfolioId}/investments?${target.toString()}`} replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect />, errorElement: <ErrorFallback /> },
  { path: '/welcome', element: <Welcome />, errorElement: <ErrorFallback /> },
  { path: '/import', element: <ImportHub />, errorElement: <ErrorFallback /> },
  {
    path: '/settings',
    element: <UserSettingsLayout />,
    errorElement: <ErrorFallback />,
    children: [{ index: true, element: <UserSettings /> }],
  },
  {
    path: '/p/:portfolioId',
    element: <PortfolioLayout />,
    errorElement: <ErrorFallback />,
    children: [
      { index: true, element: <RedirectWithSearch to="dashboard" /> },
      { path: 'dashboard', element: <Dashboard /> },                     // redirects to :dashboardId → Task 5b.3
      { path: 'dashboard/:dashboardId', element: <Dashboard /> },
      { path: 'watchlists', element: <Suspense fallback={<div />}><Watchlists /></Suspense> },
      { path: 'investments', element: <Investments /> },
      { path: 'investments/:id', element: <SecurityDetail /> },
      { path: 'transactions', element: <Transactions /> },
      { path: 'transactions/new', element: <TransactionNew /> },
      { path: 'accounts', element: <Suspense fallback={<div />}><AccountsHub /></Suspense> },
      { path: 'accounts/:id', element: <AccountDetail /> },
      { path: 'performance/securities', element: <RedirectPerfSecurities /> },
      {
        path: 'analytics',
        element: <Analytics />,
        children: [
          { index: true, element: <RedirectWithSearch to="calculation" /> },
          { path: 'calculation', element: <Calculation /> },
          { path: 'chart', element: <PerformanceChart /> },
          { path: 'income', element: <Payments /> },
        ],
      },
      { path: 'allocation', element: <AssetAllocation /> },
      { path: 'taxonomies/data-series', element: <TaxonomySeries /> },
      { path: 'securities/:id', element: <RedirectSecurityDetail /> },
      { path: 'import/csv', element: <CsvImportPage /> },
      { path: 'settings/data', element: <PortfolioSettings /> },
      // Legacy aliases retained under portfolio scope
      { path: 'performance', element: <RedirectWithSearch to="../analytics/calculation" /> },
      { path: 'performance/calculation', element: <RedirectWithSearch to="../analytics/calculation" /> },
      { path: 'performance/chart', element: <RedirectWithSearch to="../analytics/chart" /> },
      { path: 'performance/taxonomy-series', element: <RedirectWithSearch to="../taxonomies/data-series" /> },
      { path: 'reports/payments', element: <RedirectWithSearch to="../analytics/income" /> },
      { path: 'reports/statement', element: <RedirectWithSearch to="../investments" /> },
      { path: 'reports/holdings', element: <RedirectWithSearch to="../investments" /> },
      { path: 'reports/asset-allocation', element: <RedirectWithSearch to="../allocation" /> },
      { path: 'reports/dividends', element: <RedirectWithSearch to="../analytics/income" /> },
      { path: 'securities', element: <RedirectWithSearch to="../investments" /> },
      { path: 'analytics/data-series', element: <RedirectWithSearch to="../taxonomies/data-series" /> },
      { path: 'settings', element: <RedirectWithSearch to="data" /> },      // legacy: /settings used to be portfolio-level; now data
    ],
  },
]);
