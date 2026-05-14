// 4 KB is enough to catch obviously-binary input (null bytes in headers /
// magic-byte regions) without blocking on large uploads. A real CSV has no
// null bytes in UTF-8 / ASCII text.
const BINARY_SNIFF_BYTES = 4096; // native-ok

export async function validateFileClientSide(
  file: File,
): Promise<'invalidFile' | 'binary' | null> {
  if (!file.name.toLowerCase().endsWith('.csv')) return 'invalidFile';
  const slice = file.slice(0, BINARY_SNIFF_BYTES);
  const buf = new Uint8Array(await slice.arrayBuffer());
  for (let i = 0; i < buf.length; i++) { // native-ok
    if (buf[i] === 0) return 'binary';
  }
  return null;
}

export function mapServerError(message: string): 'invalidFile' | 'tooLarge' {
  if (message === 'FILE_TOO_LARGE') return 'tooLarge';
  return 'invalidFile';
}
