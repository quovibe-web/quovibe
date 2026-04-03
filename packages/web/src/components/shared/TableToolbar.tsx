/**
 * TableToolbar — unified bar above a DataTable.
 *
 * Provides a consistent layout for table actions:
 *   LEFT: search input (optional) + custom filter children
 *   RIGHT: reset button (optional), export button (optional), column visibility gear (optional)
 *
 * The column visibility popover and export button are rendered by DataTable itself
 * when `enableColumnVisibility` / `enableExport` props are set. This toolbar
 * is for the search + custom filters that sit ABOVE the DataTable.
 */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TableToolbarProps {
  /** Current search value */
  searchValue?: string;
  /** Search change handler */
  onSearchChange?: (value: string) => void;
  /** Search input placeholder (i18n) */
  searchPlaceholder?: string;
  /** Show reset button */
  enableReset?: boolean;
  /** Reset handler */
  onReset?: () => void;
  /** Custom filters/buttons rendered between search and right-side controls */
  children?: React.ReactNode;
  /** Extra className for the container */
  className?: string;
}

export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  enableReset = false,
  onReset,
  children,
  className,
}: TableToolbarProps) {
  const { t } = useTranslation('common');
  const searchRef = useRef<HTMLInputElement>(null);

  const hasSearch = onSearchChange !== undefined;

  return (
    <div
      className={cn(
        'flex flex-wrap gap-2 items-center rounded-lg bg-muted/30 border border-border/50 p-3',
        className,
      )}
    >
      {/* Search input */}
      {hasSearch && (
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchRef}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? t('search', { defaultValue: 'Search…' })}
            className="pl-9 pr-8 h-9"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Custom filter children */}
      {children}

      {/* Right-side spacer */}
      {enableReset && <div className="flex-1" />}

      {/* Reset button */}
      {enableReset && onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          {t('reset')}
        </Button>
      )}
    </div>
  );
}
