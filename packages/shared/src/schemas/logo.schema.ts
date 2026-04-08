import { z } from 'zod';
import { InstrumentType } from '../enums';

export const logoResolveSchema = z
  .object({
    ticker: z.string().min(1).optional(),
    instrumentType: z.nativeEnum(InstrumentType).optional(),
    isin: z.string().optional(),
    domain: z.string().min(1).optional(),
  })
  .refine(
    data => !!data.domain || (!!data.ticker && !!data.instrumentType),
    { message: 'Either domain or (ticker + instrumentType) must be provided' },
  );

export type LogoResolveRequest = z.infer<typeof logoResolveSchema>;
