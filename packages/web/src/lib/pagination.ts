export function getPageNumbers(page: number, totalPages: number): (number | '…')[] {
  const delta = 2;
  const range = new Set<number>();
  range.add(1);
  range.add(totalPages);
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    range.add(i);
  }
  const sorted = Array.from(range).sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) result.push('…');
    result.push(n);
    prev = n;
  }
  return result;
}
