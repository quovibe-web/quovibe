// packages/shared/src/csv/type-aliases.ts
import { TransactionType } from '../enums';

/**
 * Multilingual alias map for transaction types.
 * Keys are lowercase aliases, values are TransactionType enum values.
 * This map is used by the CSV normalizer to resolve user-facing type strings.
 */
export const transactionTypeAliases: ReadonlyMap<string, TransactionType> = new Map([
  // English
  ['buy', TransactionType.BUY],
  ['sell', TransactionType.SELL],
  ['dividend', TransactionType.DIVIDEND],
  ['deposit', TransactionType.DEPOSIT],
  ['removal', TransactionType.REMOVAL],
  ['withdrawal', TransactionType.REMOVAL],
  ['interest', TransactionType.INTEREST],
  ['interest charge', TransactionType.INTEREST_CHARGE],
  ['fees', TransactionType.FEES],
  ['fees refund', TransactionType.FEES_REFUND],
  ['taxes', TransactionType.TAXES],
  ['tax refund', TransactionType.TAX_REFUND],
  ['delivery (inbound)', TransactionType.DELIVERY_INBOUND],
  ['delivery (outbound)', TransactionType.DELIVERY_OUTBOUND],
  ['delivery inbound', TransactionType.DELIVERY_INBOUND],
  ['delivery outbound', TransactionType.DELIVERY_OUTBOUND],
  ['transfer (inbound)', TransactionType.DELIVERY_INBOUND],
  ['transfer (outbound)', TransactionType.DELIVERY_OUTBOUND],

  // German
  ['kauf', TransactionType.BUY],
  ['verkauf', TransactionType.SELL],
  ['dividende', TransactionType.DIVIDEND],
  ['einlage', TransactionType.DEPOSIT],
  ['entnahme', TransactionType.REMOVAL],
  ['zinsen', TransactionType.INTEREST],
  ['zinsbelastung', TransactionType.INTEREST_CHARGE],
  ['gebuehren', TransactionType.FEES],
  ['gebühren', TransactionType.FEES],
  ['gebührenerstattung', TransactionType.FEES_REFUND],
  ['steuern', TransactionType.TAXES],
  ['steuererstattung', TransactionType.TAX_REFUND],
  ['einlieferung', TransactionType.DELIVERY_INBOUND],
  ['auslieferung', TransactionType.DELIVERY_OUTBOUND],

  // French
  ['achat', TransactionType.BUY],
  ['vente', TransactionType.SELL],
  ['depot', TransactionType.DEPOSIT],
  ['retrait', TransactionType.REMOVAL],
  ['intérêts', TransactionType.INTEREST],
  ['interets', TransactionType.INTEREST],
  ['frais', TransactionType.FEES],
  ['remboursement frais', TransactionType.FEES_REFUND],
  ['impôts', TransactionType.TAXES],
  ['impots', TransactionType.TAXES],
  ['remboursement impôts', TransactionType.TAX_REFUND],
  ['remboursement impots', TransactionType.TAX_REFUND],
  ['livraison entrante', TransactionType.DELIVERY_INBOUND],
  ['livraison sortante', TransactionType.DELIVERY_OUTBOUND],

  // Italian
  ['acquisto', TransactionType.BUY],
  ['vendita', TransactionType.SELL],
  ['dividendo', TransactionType.DIVIDEND],
  ['deposito', TransactionType.DEPOSIT],
  ['prelievo', TransactionType.REMOVAL],
  ['interessi', TransactionType.INTEREST],
  ['addebito interessi', TransactionType.INTEREST_CHARGE],
  ['commissioni', TransactionType.FEES],
  ['rimborso commissioni', TransactionType.FEES_REFUND],
  ['tasse', TransactionType.TAXES],
  ['rimborso tasse', TransactionType.TAX_REFUND],
  ['consegna in entrata', TransactionType.DELIVERY_INBOUND],
  ['consegna in uscita', TransactionType.DELIVERY_OUTBOUND],

  // Spanish
  ['compra', TransactionType.BUY],
  ['comprar', TransactionType.BUY],
  ['venta', TransactionType.SELL],
  ['vender', TransactionType.SELL],
  ['depósito', TransactionType.DEPOSIT],
  ['retiro', TransactionType.REMOVAL],
  ['interés', TransactionType.INTEREST],
  ['interes', TransactionType.INTEREST],
  ['cargo por intereses', TransactionType.INTEREST_CHARGE],
  ['comisiones', TransactionType.FEES],
  ['reembolso comisiones', TransactionType.FEES_REFUND],
  ['impuestos', TransactionType.TAXES],
  ['reembolso impuestos', TransactionType.TAX_REFUND],
  ['entrega entrante', TransactionType.DELIVERY_INBOUND],
  ['entrega saliente', TransactionType.DELIVERY_OUTBOUND],

  // Dutch
  ['kopen', TransactionType.BUY],
  ['verkopen', TransactionType.SELL],
  ['storting', TransactionType.DEPOSIT],
  ['opname', TransactionType.REMOVAL],
  ['rente', TransactionType.INTEREST],
  ['rentelast', TransactionType.INTEREST_CHARGE],
  ['kosten', TransactionType.FEES],
  ['kostenvergoeding', TransactionType.FEES_REFUND],
  ['belastingen', TransactionType.TAXES],
  ['belastingteruggave', TransactionType.TAX_REFUND],
  ['inlevering', TransactionType.DELIVERY_INBOUND],
  ['uitlevering', TransactionType.DELIVERY_OUTBOUND],

  // Polish
  ['kupno', TransactionType.BUY],
  ['sprzedaż', TransactionType.SELL],
  ['sprzedaz', TransactionType.SELL],
  ['dywidenda', TransactionType.DIVIDEND],
  ['wpłata', TransactionType.DEPOSIT],
  ['wplata', TransactionType.DEPOSIT],
  ['wypłata', TransactionType.REMOVAL],
  ['wyplata', TransactionType.REMOVAL],
  ['odsetki', TransactionType.INTEREST],
  ['obciążenie odsetkowe', TransactionType.INTEREST_CHARGE],
  ['obciazenie odsetkowe', TransactionType.INTEREST_CHARGE],
  ['opłaty', TransactionType.FEES],
  ['oplaty', TransactionType.FEES],
  ['zwrot opłat', TransactionType.FEES_REFUND],
  ['zwrot oplat', TransactionType.FEES_REFUND],
  ['podatki', TransactionType.TAXES],
  ['zwrot podatku', TransactionType.TAX_REFUND],
  ['dostawa przychodząca', TransactionType.DELIVERY_INBOUND],
  ['dostawa przychodzaca', TransactionType.DELIVERY_INBOUND],
  ['dostawa wychodząca', TransactionType.DELIVERY_OUTBOUND],
  ['dostawa wychodzaca', TransactionType.DELIVERY_OUTBOUND],

  // Portuguese
  // Note: 'compra' and 'comprar' (BUY) are shared with Spanish — Map deduplication means
  // the Spanish entries above already cover Portuguese BUY users.
  // 'depósito' (DEPOSIT) is also shared with Spanish above; 'deposito' (unaccented) covers
  // both without conflict. 'depositar' is added as an unambiguous Portuguese verb form.
  ['depositar', TransactionType.DEPOSIT],
  ['venda', TransactionType.SELL],
  ['levantamento', TransactionType.REMOVAL],
  ['juros', TransactionType.INTEREST],
  ['encargo de juros', TransactionType.INTEREST_CHARGE],
  ['taxas', TransactionType.FEES],
  ['reembolso taxas', TransactionType.FEES_REFUND],
  ['impostos', TransactionType.TAXES],
  ['reembolso impostos', TransactionType.TAX_REFUND],
  ['entrega entrada', TransactionType.DELIVERY_INBOUND],
  ['entrega saída', TransactionType.DELIVERY_OUTBOUND],
  ['entrega saida', TransactionType.DELIVERY_OUTBOUND],

  // Direct enum values (users may paste the raw type)
  ['delivery_inbound', TransactionType.DELIVERY_INBOUND],
  ['delivery_outbound', TransactionType.DELIVERY_OUTBOUND],
  ['interest_charge', TransactionType.INTEREST_CHARGE],
  ['fees_refund', TransactionType.FEES_REFUND],
  ['tax_refund', TransactionType.TAX_REFUND],

  // Dutch - dividend (shared key, last write wins — same value)
  ['dividend', TransactionType.DIVIDEND],
]);
