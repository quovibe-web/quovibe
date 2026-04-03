import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useParams, useSearchParams } from 'react-router-dom';
const AccountsHub = lazy(() => import('./pages/AccountsHub'));
const Watchlists = lazy(() => import('./pages/Watchlists'));
import { Shell } from '@/components/layout/Shell';
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
import Settings from '@/pages/Settings';
import TaxonomySeries from '@/pages/TaxonomySeries';
import ImportPage from '@/pages/ImportPage';
import CsvImportPage from '@/pages/CsvImportPage';
import Analytics from '@/pages/Analytics';
import { ErrorFallback } from '@/components/shared/ErrorFallback';

function RedirectSecurityDetail() {
  const { id } = useParams();
  return <Navigate to={`/investments/${id}`} replace />;
}

function RedirectPerfSecurities() {
  const [searchParams] = useSearchParams();
  const target = new URLSearchParams(searchParams);
  target.set('view', 'performance');
  return <Navigate to={`/investments?${target.toString()}`} replace />;
}

export const router = createBrowserRouter([
  {
    path: '/import',
    element: <ImportPage />,  // standalone, no sidebar/shell
    errorElement: <ErrorFallback />,
  },
  {
    path: '/',
    element: <Shell />,
    errorElement: <ErrorFallback />,
    children: [
      { index: true, element: <Dashboard /> },
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
          { index: true, element: <Navigate to="/analytics/calculation" replace /> },
          { path: 'calculation', element: <Calculation /> },
          { path: 'chart', element: <PerformanceChart /> },
          { path: 'income', element: <Payments /> },
        ],
      },
      { path: 'performance', element: <Navigate to="/analytics/calculation" replace /> },
      { path: 'performance/calculation', element: <Navigate to="/analytics/calculation" replace /> },
      { path: 'performance/chart', element: <Navigate to="/analytics/chart" replace /> },
      { path: 'performance/taxonomy-series', element: <Navigate to="/taxonomies/data-series" replace /> },
      { path: 'analytics/data-series', element: <Navigate to="/taxonomies/data-series" replace /> },
      { path: 'reports/payments', element: <Navigate to="/analytics/income" replace /> },
      { path: 'reports/statement', element: <Navigate to="/investments" replace /> },
      { path: 'reports/holdings', element: <Navigate to="/investments" replace /> },
      { path: 'allocation', element: <AssetAllocation /> },
      { path: 'taxonomies/data-series', element: <TaxonomySeries /> },
      { path: 'reports/asset-allocation', element: <Navigate to="/allocation" replace /> },
      { path: 'reports/dividends', element: <Navigate to="/analytics/income" replace /> },
      { path: 'securities', element: <Navigate to="/investments" replace /> },
      { path: 'securities/:id', element: <RedirectSecurityDetail /> },
      { path: 'import/csv', element: <CsvImportPage /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
