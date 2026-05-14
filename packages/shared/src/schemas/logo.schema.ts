import { z } from 'zod';
import { InstrumentType } from '../enums';

export const logoResolveSchema = z
  .object({
    ticker: z.string().min(1).optional(),
    /**
     * Caller's best guess at the instrument type. Used as a fallback when
     * Yahoo quoteSummary cannot classify the ticker, and as an early-exit
     * shortcut for CRYPTO (skips Yahoo entirely → CoinGecko). For all other
     * branches the resolver's own quoteSummary classification wins, since
     * Yahoo /search results sometimes carry stale or UNKNOWN types.
     */
    instrumentType: z.nativeEnum(InstrumentType).optional(),
    isin: z.string().min(1).optional(), // reserved for future ISIN-based logo lookup
    domain: z.string().min(1).optional(),
  })
  .refine(
    data => !!data.domain || !!data.ticker,
    {
      message: 'Either domain or ticker must be provided',
      path: ['ticker'],
    },
  );

export type LogoResolveRequest = z.infer<typeof logoResolveSchema>;
