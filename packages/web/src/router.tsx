import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { PortfolioLayout } from '@/layouts/PortfolioLayout';
import { ErrorFallback } from '@/components/shared/ErrorFallback';
import { RootRedirect } from '@/components/shared/RootRedirect';

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

function RedirectSecurityDetail() {
  const { id, portfolioId } = useParams();
  return <Navigate to={`/p/${portfolioId}/investments/${id}`} replace />;
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
  { path: '/settings', element: <UserSettings />, errorElement: <ErrorFallback /> },
  {
    path: '/p/:portfolioId',
    element: <PortfolioLayout />,
    errorElement: <ErrorFallback />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
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
          { index: true, element: <Navigate to="calculation" replace /> },
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
      { path: 'performance', element: <Navigate to="../analytics/calculation" replace /> },
      { path: 'performance/calculation', element: <Navigate to="../analytics/calculation" replace /> },
      { path: 'performance/chart', element: <Navigate to="../analytics/chart" replace /> },
      { path: 'performance/taxonomy-series', element: <Navigate to="../taxonomies/data-series" replace /> },
      { path: 'reports/payments', element: <Navigate to="../analytics/income" replace /> },
      { path: 'reports/statement', element: <Navigate to="../investments" replace /> },
      { path: 'reports/holdings', element: <Navigate to="../investments" replace /> },
      { path: 'reports/asset-allocation', element: <Navigate to="../allocation" replace /> },
      { path: 'reports/dividends', element: <Navigate to="../analytics/income" replace /> },
      { path: 'securities', element: <Navigate to="../investments" replace /> },
      { path: 'analytics/data-series', element: <Navigate to="../taxonomies/data-series" replace /> },
      { path: 'settings', element: <Navigate to="data" replace /> },      // legacy: /settings used to be portfolio-level; now data
    ],
  },
]);
