import { useId } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface Segment<T extends string = string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string = string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Size variant */
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  segments,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const layoutId = useId();

  return (
    <div
      className={cn(
        'inline-flex bg-muted rounded-full p-0.5',
        className,
      )}
    >
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <button
            key={segment.value}
            onClick={() => onChange(segment.value)}
            className={cn(
              'relative rounded-full font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isActive && (
              <motion.div
                layoutId={`seg-indicator-${layoutId}`}
                className="absolute inset-0 rounded-full bg-background shadow-sm"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{segment.label}</span>
          </button>
        );
      })}
    </div>
  );
}
