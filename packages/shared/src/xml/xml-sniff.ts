// packages/shared/src/xml/xml-sniff.ts
//
// Structural sniff for the Portfolio Performance XML import wizard
// (ImportHub.tsx). Runs on the client before POST on the first ~4 KB of the
// selected file. Blocks uploads when the file clearly isn't XML — binaries
// masquerading as `.xml` or plain-text garbage that bypasses the browser's
// `accept=".xml"` hint via drag-and-drop or programmatic file setting
// (BUG-09). The heuristic is loose on purpose: the root-element check
// (`<client>` with `id` attributes) stays on the server in
// `import.service.ts:validateXmlFormat` — this helper does not duplicate it.

export type XmlSniffReason =
  | 'NOT_TEXT'
  | 'NO_XML_PROLOG_OR_ROOT';

export interface XmlSniffResult {
  ok: boolean;
  reason: XmlSniffReason | null;
}

export function sniffLikelyXml(head: string): XmlSniffResult {
  for (let i = 0; i < head.length; i++) { // native-ok
    if (head.charCodeAt(i) === 0) {
      return { ok: false, reason: 'NOT_TEXT' };
    }
  }
  const stripped = head.replace(/^\uFEFF/, '').trimStart();
  if (!stripped.startsWith('<')) {
    return { ok: false, reason: 'NO_XML_PROLOG_OR_ROOT' };
  }
  return { ok: true, reason: null };
}
