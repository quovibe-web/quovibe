const ANALYTICS_SUBPATHS = new Set(['calculation', 'chart', 'income']);

export function portfolioSectionPath(pathname: string): string {
  const tail = pathname.replace(/^\/p\/[^/]+\/?/, '');
  const [first, second] = tail.split('/').filter(Boolean);

  switch (first) {
    case 'dashboard':
    case 'investments':
    case 'transactions':
    case 'accounts':
    case 'watchlists':
    case 'allocation':
      return `/${first}`;
    case 'analytics':
      return `/analytics/${ANALYTICS_SUBPATHS.has(second ?? '') ? second : 'calculation'}`;
    case 'settings':
      return '/settings/data';
    case 'taxonomies':
      return '/taxonomies/data-series';
    case 'import':
      return '/import/csv';
    default:
      return '/dashboard';
  }
}
