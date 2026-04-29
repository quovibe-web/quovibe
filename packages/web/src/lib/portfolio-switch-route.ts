const ANALYTICS_SUBPATHS = new Set(['calculation', 'chart', 'income']);

export function portfolioSectionPath(pathname: string): string {
  // User-scope URLs (no /p/<id>/ prefix) have no matching section to preserve;
  // default to /dashboard on switch. Without this guard, /settings hits the
  // 'settings' case and routes to /settings/data (portfolio-level), not user prefs.
  if (!pathname.startsWith('/p/')) return '/dashboard';

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
