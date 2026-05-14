import { describe, it, expect } from 'vitest';
import { getImportTiles, type ImportTile } from '../PortfolioImportHub';

describe('getImportTiles', () => {
  it('returns the 4 import tiles scoped to a portfolio', () => {
    const tiles = getImportTiles('PFOLIO_A');
    expect(tiles.map((t) => t.id)).toEqual(['tradesCsv', 'pricesCsv', 'pdf', 'ibFlex']);
  });

  it('Trades CSV is available and routes to the wizard', () => {
    const tile = getImportTiles('PFOLIO_A').find((t) => t.id === 'tradesCsv') as ImportTile;
    expect(tile.status).toBe('available');
    if (tile.status === 'available') {
      expect(tile.href).toBe('/p/PFOLIO_A/import/csv');
    }
  });

  it('Prices CSV is available and routes to the wizard', () => {
    const tile = getImportTiles('PFOLIO_A').find((t) => t.id === 'pricesCsv') as ImportTile;
    expect(tile.status).toBe('available');
    if (tile.status === 'available') {
      expect(tile.href).toBe('/p/PFOLIO_A/import/prices');
      expect('hasHint' in tile && tile.hasHint).toBeFalsy();
    }
  });

  it('PDF and IB Flex tiles are coming soon (no href in shape)', () => {
    const tiles = getImportTiles('PFOLIO_A');
    const pdf = tiles.find((t) => t.id === 'pdf') as ImportTile;
    const flex = tiles.find((t) => t.id === 'ibFlex') as ImportTile;
    expect(pdf.status).toBe('comingSoon');
    expect(flex.status).toBe('comingSoon');
    expect('href' in pdf).toBe(false);
    expect('href' in flex).toBe(false);
  });
});
