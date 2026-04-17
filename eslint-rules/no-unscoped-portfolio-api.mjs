/**
 * Flags literal strings `'/api/<scoped-segment>/...'` passed to `apiFetch(...)`.
 *
 * Scoped segments are those mounted under `/api/p/:portfolioId/*` in
 * packages/api/src/create-app.ts. If new routers are added there, add them
 * to SCOPED_SEGMENTS below.
 *
 * - Using `api.fetch(...)` or `scopedFetch(...)` is always OK (these wrappers
 *   rewrite `/api/...` to `/api/p/:portfolioId/...`).
 * - Template strings that literally start with `/api/p/` are always OK.
 * - Static strings like `'/api/events'` or `'/api/settings'` are OK because
 *   those routers are mounted unscoped.
 */
const SCOPED_SEGMENTS = [
  'accounts',
  'attribute-types',
  'calendars',
  'chart-config',
  'csv-import',
  'dashboards',
  'debug',
  'performance',
  'portfolio',
  'prices',
  'reports',
  'securities',
  'taxonomies',
  'transactions',
  'watchlists',
];

function urlStartsWithScopedSegment(raw) {
  const stripped = raw.replace(/^['"`]/, '').replace(/['"`]$/, '');
  if (!stripped.startsWith('/api/')) return false;
  if (stripped.startsWith('/api/p/')) return false;
  const afterApi = stripped.slice('/api/'.length);
  const firstSegment = afterApi.split(/[/?#]/, 1)[0];
  return SCOPED_SEGMENTS.includes(firstSegment);
}

function isLiteralOrTemplateScopedUrl(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return urlStartsWithScopedSegment(node.value);
  }
  if (node.type === 'TemplateLiteral' && node.quasis.length > 0) {
    const head = node.quasis[0].value.cooked ?? '';
    return urlStartsWithScopedSegment(head);
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling apiFetch with an unscoped portfolio-scoped endpoint. Use useScopedApi().fetch or pass the full /api/p/:portfolioId/... URL.',
    },
    messages: {
      unscopedPortfolioApi:
        'This URL is mounted at /api/p/:portfolioId/... on the server. Use useScopedApi().fetch(...) or a `/api/p/${portfolioId}/...` template literal instead of apiFetch().',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'apiFetch') return;
        const arg = node.arguments[0];
        if (!arg) return;
        if (isLiteralOrTemplateScopedUrl(arg)) {
          context.report({ node: arg, messageId: 'unscopedPortfolioApi' });
        }
      },
    };
  },
};
