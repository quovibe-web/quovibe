// Stub browser globals needed by formatters in the node environment.
// jsdom-environment tests get their navigator from jsdom itself and do not
// need (and would conflict with) this stub.
if (typeof window === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'en-US' },
    writable: true,
  });
}
