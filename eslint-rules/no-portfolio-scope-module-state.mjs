// Custom ESLint rule: forbid module-scope mutable state that could hold
// portfolio-scoped data.
//
// Background: ADR-016 and the confirmed RC-1 bug in services/statement-cache.ts
// showed that module-scope `let` / `new Map()` / `new Set()` caches, when keyed
// only by date or not at all, leak portfolio data across requests in a
// multi-portfolio URL-scoped setup.
//
// Rule details:
// - Forbids module-scope `let` and `var` declarations.
// - Forbids module-scope `const x = new (Map|Set|WeakMap|WeakSet)()` with
//   zero arguments (i.e. empty-then-filled — the leak pattern). `new Set([
//   literals ])` and `new Map([[k, v], ...])` are allowed because they are
//   readonly-by-convention enum patterns with no room to accumulate state.
// - Escape valve: a preceding line comment `// quovibe:allow-module-state — <reason>`
//   (em-dash OR ASCII hyphen) with non-empty justification suppresses the report.
// - `new PortfolioCache<T>()` is the sanctioned per-portfolio cache pattern
//   (WeakMap keyed by sqlite handle); instantiations are recognized by the
//   constructor name.

const ALLOW_COMMENT_RE = /quovibe:allow-module-state\s*[—\-]\s*\S+/;
const FORBIDDEN_CTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

function isAtModuleScope(node) {
  let p = node.parent;
  while (p && (p.type === 'ExportNamedDeclaration' || p.type === 'ExportDefaultDeclaration')) {
    p = p.parent;
  }
  return Boolean(p && p.type === 'Program');
}

function hasAllowComment(sourceCode, node) {
  const comments = sourceCode.getCommentsBefore(node);
  return comments.some((c) => ALLOW_COMMENT_RE.test(c.value));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid module-scope mutable state that could hold portfolio-scoped data (ADR-016).',
    },
    schema: [],
    messages: {
      noLet:
        'Module-scope `{{kind}}` is forbidden (ADR-016: portfolio-scoped state must flow through function parameters, req, or PortfolioCache<T>). Suppress with: // quovibe:allow-module-state — <reason>',
      noEmptyCtor:
        'Module-scope `new {{ctor}}()` without arguments is forbidden (ADR-016: this is the cross-request leak pattern; use PortfolioCache<T> for per-portfolio caches). Suppress with: // quovibe:allow-module-state — <reason>',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    return {
      VariableDeclaration(node) {
        if (node.kind === 'const') return;
        if (!isAtModuleScope(node)) return;
        const wrapper =
          node.parent && (node.parent.type === 'ExportNamedDeclaration' || node.parent.type === 'ExportDefaultDeclaration')
            ? node.parent
            : node;
        if (hasAllowComment(sourceCode, wrapper)) return;
        context.report({ node, messageId: 'noLet', data: { kind: node.kind } });
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        const ctor = node.callee.name;
        if (!FORBIDDEN_CTORS.has(ctor)) return;
        if (node.arguments.length > 0) return;

        // Find the enclosing VariableDeclarator + VariableDeclaration.
        const declarator = node.parent;
        if (!declarator || declarator.type !== 'VariableDeclarator') return;
        const varDecl = declarator.parent;
        if (!varDecl || varDecl.type !== 'VariableDeclaration') return;
        if (!isAtModuleScope(varDecl)) return;

        const wrapper =
          varDecl.parent && (varDecl.parent.type === 'ExportNamedDeclaration' || varDecl.parent.type === 'ExportDefaultDeclaration')
            ? varDecl.parent
            : varDecl;
        if (hasAllowComment(sourceCode, wrapper)) return;

        context.report({ node: varDecl, messageId: 'noEmptyCtor', data: { ctor } });
      },
    };
  },
};
