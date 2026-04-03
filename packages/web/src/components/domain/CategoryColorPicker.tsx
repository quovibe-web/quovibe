import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const PALETTE = [
  '#4ade80', '#f97316', '#a78bfa', '#38bdf8',
  '#f472b6', '#facc15', '#34d399', '#fb923c',
  '#818cf8', '#22d3ee', '#e879f9', '#fbbf24',
  '#6ee7b7', '#f87171', '#60a5fa', '#c084fc',
];

interface Props {
  currentColor: string | null;
  onColorChange: (color: string) => void;
  usedColors?: Set<string>;
  children: React.ReactNode;
}

// Exported for use inside DropdownMenuSubContent or other containers
export function ColorPaletteContent({ currentColor, onColorChange, usedColors }: {
  currentColor: string | null;
  onColorChange: (color: string) => void;
  usedColors?: Set<string>;
}) {
  const { t } = useTranslation('reports');
  const [customHex, setCustomHex] = useState(currentColor ?? '#000000');

  const isHexUsed = usedColors?.has(customHex.toLowerCase())
    && customHex.toLowerCase() !== currentColor?.toLowerCase();

  return (
    <>
      <p className="text-xs font-medium text-muted-foreground mb-2">
        {t('taxonomyManagement.changeColor')}
      </p>
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {PALETTE.map((color) => {
          const isCurrent = currentColor?.toLowerCase() === color.toLowerCase();
          const isUsed = !isCurrent && (usedColors?.has(color.toLowerCase()) ?? false);

          return (
            <button
              key={color}
              onClick={() => onColorChange(color)}
              className={cn(
                'w-8 h-8 rounded-md transition-all hover:scale-110 relative overflow-hidden',
                isCurrent && 'ring-2 ring-offset-2 ring-foreground',
              )}
              style={{ backgroundColor: color }}
              title={isUsed ? t('taxonomyManagement.colorInUse', 'Already in use') : color}
            >
              {isCurrent && (
                <Check className="h-3.5 w-3.5 text-white absolute inset-0 m-auto drop-shadow-sm" />
              )}
              {isUsed && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 28 28"
                >
                  <line
                    x1="6" y1="22" x2="22" y2="6"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <line
                    x1="6" y1="22" x2="22" y2="6"
                    stroke="rgba(0,0,0,0.7)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 items-center">
        <span
          className="w-8 h-8 rounded-md shrink-0 border border-white/20"
          style={{ backgroundColor: customHex }}
        />
        <Input
          value={customHex}
          onChange={(e) => setCustomHex(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onColorChange(customHex); }}
          placeholder="#hex"
          className="h-8 text-xs"
        />
        <Button size="sm" className="h-8 px-2" onClick={() => onColorChange(customHex)}>
          OK
        </Button>
      </div>
      {isHexUsed && (
        <p className="text-xs text-[var(--qv-warning)] mt-1">
          {t('taxonomyManagement.colorInUse', 'Already in use by another category')}
        </p>
      )}
    </>
  );
}

// Popover-based wrapper for non-dropdown usage
export function CategoryColorPicker({ currentColor, onColorChange, children }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-52 p-3" align="start">
        <ColorPaletteContent currentColor={currentColor} onColorChange={onColorChange} />
      </PopoverContent>
    </Popover>
  );
}
