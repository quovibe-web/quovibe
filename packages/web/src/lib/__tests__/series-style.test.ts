import { describe, expect, it } from 'vitest';
import { getSeriesStyle } from '../series-style';

describe('getSeriesStyle', () => {
  describe('portfolio role', () => {
    it('returns 3px solid base color', () => {
      const s = getSeriesStyle({ role: 'portfolio', color: '#4385BE', isHovered: false, anyHovered: false });
      expect(s.lineWidth).toBe(3);
      expect(s.lineStyle).toBe('solid');
      expect(s.color).toBe('#4385BE');
    });
  });

  describe('holding role', () => {
    it('returns 2px solid base color', () => {
      const s = getSeriesStyle({ role: 'holding', color: '#DA702C', isHovered: false, anyHovered: false });
      expect(s.lineWidth).toBe(2);
      expect(s.lineStyle).toBe('solid');
      expect(s.color).toBe('#DA702C');
    });
  });

  describe('reference role', () => {
    it('returns 1.5px dashed with alpha 0.85', () => {
      const s = getSeriesStyle({ role: 'reference', color: '#3AA99F', isHovered: false, anyHovered: false });
      expect(s.lineWidth).toBe(1.5);
      expect(s.lineStyle).toBe('dashed');
      // hex with alpha 0.85 ends in D9
      expect(s.color.toUpperCase()).toBe('#3AA99FD9');
    });
  });

  describe('hover behavior', () => {
    it('adds 0.5px when isHovered', () => {
      expect(getSeriesStyle({ role: 'portfolio', color: '#4385BE', isHovered: true, anyHovered: true }).lineWidth).toBe(3.5);
      expect(getSeriesStyle({ role: 'holding', color: '#DA702C', isHovered: true, anyHovered: true }).lineWidth).toBe(2.5);
      expect(getSeriesStyle({ role: 'reference', color: '#3AA99F', isHovered: true, anyHovered: true }).lineWidth).toBe(2);
    });

    it('dims peers (anyHovered && !isHovered) to alpha 0.35', () => {
      const s = getSeriesStyle({ role: 'holding', color: '#DA702C', isHovered: false, anyHovered: true });
      // 0.35 * 255 ≈ 89.25, rounds to 89 = 0x59
      expect(s.color.toUpperCase()).toMatch(/59$/);
    });

    it('hovered reference still gets dashed style (style is role-bound, not hover-bound)', () => {
      const s = getSeriesStyle({ role: 'reference', color: '#3AA99F', isHovered: true, anyHovered: true });
      expect(s.lineStyle).toBe('dashed');
    });

    it('hovered reference shows full-alpha color — hover wins over role-default alpha', () => {
      // withAlpha(color, 1.0) always appends 'ff' byte for hex — #3AA99F → #3AA99Fff
      // Hovered series is the focal point; role-default alpha 0.85 is overridden.
      const s = getSeriesStyle({ role: 'reference', color: '#3AA99F', isHovered: true, anyHovered: true });
      expect(s.color.toUpperCase()).toBe('#3AA99FFF');
    });

    it('peer reference (not hovered, anyHovered=true) gets 0.35 alpha (overrides 0.85)', () => {
      const s = getSeriesStyle({ role: 'reference', color: '#3AA99F', isHovered: false, anyHovered: true });
      expect(s.color.toUpperCase()).toMatch(/59$/);
    });

    it('no hover state: reference still has 0.85 alpha', () => {
      const s = getSeriesStyle({ role: 'reference', color: '#3AA99F', isHovered: false, anyHovered: false });
      expect(s.color.toUpperCase()).toBe('#3AA99FD9');
    });
  });

  describe('color input formats', () => {
    it('accepts short hex #abc and expands', () => {
      const s = getSeriesStyle({ role: 'reference', color: '#abc', isHovered: false, anyHovered: false });
      // #abc → #aabbcc; with alpha 0.85 → #aabbccd9
      expect(s.color.toUpperCase()).toBe('#AABBCCD9');
    });

    it('accepts hex with alpha and reapplies our alpha (overwrites caller alpha)', () => {
      const s = getSeriesStyle({ role: 'reference', color: '#3AA99FFF', isHovered: false, anyHovered: false });
      // withAlpha strips to 6-char base (#3AA99F) via slice(0,7), then appends d9
      expect(s.color.toUpperCase()).toBe('#3AA99FD9');
    });
  });
});
