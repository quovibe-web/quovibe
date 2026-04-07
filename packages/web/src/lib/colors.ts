import type React from 'react';

/** Read a CSS custom property value at runtime */
function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Static fallback colors (light theme values) */
const FALLBACK = {
  profit: '#66800b',
  loss: '#d14d41',
  dividend: '#4385BE',
  cyan: 'hsl(225, 25%, 48%)',
  violet: '#8B7EC8',
  success: '#66800b',
  danger: '#af3029',
  warning: '#ad8301',
} as const;

type ColorKey = keyof typeof FALLBACK;

const VAR_MAP: Record<ColorKey, string> = {
  profit: '--qv-success',
  loss: '--qv-danger',
  dividend: '--color-chart-1',
  cyan: '--color-primary',
  violet: '--color-chart-5',
  success: '--qv-success',
  danger: '--qv-danger',
  warning: '--qv-warning',
};

/** Get current theme-aware color from CSS variable */
export function getColor(key: ColorKey): string {
  if (typeof document === 'undefined') return FALLBACK[key];
  return getCssVar(VAR_MAP[key]) || FALLBACK[key];
}

/** Return inline color style for a signed value: green for positive, red for negative, undefined for zero */
export function getValueColorStyle(value: number, isPrivate: boolean): React.CSSProperties | undefined {
  if (isPrivate) return undefined;
  if (value > 0) return { color: getColor('profit') };
  if (value < 0) return { color: getColor('loss') };
  return undefined;
}

/** Parse a CSS var's computed value to [r, g, b]. Returns null on failure. */
export function getCssVarRgb(varName: string): [number, number, number] | null {
  if (typeof document === 'undefined') return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return null;

  // Try hex: #rrggbb
  const hexMatch = raw.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hexMatch) {
    return [parseInt(hexMatch[1], 16), parseInt(hexMatch[2], 16), parseInt(hexMatch[3], 16)];
  }

  // Try rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }

  return null;
}

/**
 * Convert any CSS color string to #rrggbb hex.
 * Uses a temporary canvas context for reliable browser-native conversion.
 */
export function colorToHex(color: string): string {
  // Already hex
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (typeof document === 'undefined') return color;

  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return color;
  ctx.fillStyle = color;
  // The browser normalises any CSS color to #rrggbb in fillStyle
  return ctx.fillStyle;
}

/** Backward-compatible COLORS object — reads live CSS var values */
export const COLORS = new Proxy(FALLBACK, {
  get(target, prop: string) {
    if (prop in target) return getColor(prop as ColorKey);
    return undefined;
  },
});
