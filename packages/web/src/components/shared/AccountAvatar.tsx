import { useState } from 'react';
import { cn } from '@/lib/utils';

const SIZE: Record<string, string> = {
  xs: 'h-5 w-5 text-[8px]',
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

interface AccountAvatarProps {
  name: string;
  logoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  rounded?: 'md' | 'full';
}

export function AccountAvatar({
  name,
  logoUrl,
  size = 'sm',
  className,
  rounded = 'md',
}: AccountAvatarProps) {
  const [errored, setErrored] = useState(false);

  const initials = name
    .split(/\s+/)
    .slice(0, 2) // native-ok
    .map((w) => w[0]) // native-ok
    .join('')
    .toUpperCase();

  const sizeClass = SIZE[size] ?? SIZE.sm;
  const roundedClass = rounded === 'full' ? 'rounded-full' : 'rounded';

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
