import { useState } from 'react';
import { cn } from '@/lib/utils';

const SIZE: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
  xs: 'h-5 w-5 text-[8px]',
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-20 w-20 text-xl',
};

interface SecurityAvatarProps {
  name: string;
  logoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  rounded?: 'md' | 'full' | 'lg';
}

export function SecurityAvatar({
  name,
  logoUrl,
  size = 'sm',
  className,
  rounded = 'md',
}: SecurityAvatarProps) {
  const [errored, setErrored] = useState(false);

  const initials = name
    .split(/\s+/)
    .slice(0, 2) // native-ok
    .map((w) => w[0]) // native-ok
    .join('')
    .toUpperCase();

  const sizeClass = SIZE[size] ?? SIZE.sm;
  const roundedClass =
    rounded === 'full' ? 'rounded-full' :
    rounded === 'lg'   ? 'rounded-lg'   :
    'rounded';

  if (logoUrl && !errored) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={cn('object-contain shrink-0', sizeClass, roundedClass, className)}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center font-semibold shrink-0 bg-muted text-muted-foreground',
        sizeClass,
        roundedClass,
        className,
      )}
    >
      {initials}
    </div>
  );
}
