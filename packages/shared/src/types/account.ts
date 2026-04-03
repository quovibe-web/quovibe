import { AccountType } from '../enums';

export interface Account {
  id: string;
  name: string;
  type: AccountType | null;
  // DEPOSIT accounts own their currency; SECURITIES accounts inherit from referenceAccount (may be null)
  currency: string | null;
  isRetired: boolean;
  referenceAccountId: string | null;
}
