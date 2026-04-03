import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert a TransactionType enum value to a camelCase i18n key.
 * INTEREST_CHARGE → interestCharge, DELIVERY_INBOUND → deliveryInbound, BUY → buy
 */
export function txTypeKey(type: string): string {
  return type.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
