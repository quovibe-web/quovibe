export function maskCurrency(value: string | number, isPrivate: boolean): string {
  return isPrivate ? '••••••' : String(value);
}

export function maskShares(value: string | number, isPrivate: boolean): string {
  return isPrivate ? '•••' : String(value);
}
