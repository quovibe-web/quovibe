import NumberFlow, { type Format } from '@number-flow/react';
import { formatNumber } from '@/lib/formatters';
import i18n from '@/i18n';

interface AccessibleNumberFlowProps {
  value: number;
  format: Format;
  className?: string;
  animated?: boolean;
}

/**
 * NumberFlow wrapper that exposes its value to textContent, Ctrl+F, copy-paste,
 * and screen readers. NumberFlow's shadow DOM is invisible to all four; we add
 * a visually-hidden sibling span carrying the same plain-text rendition and
 * mark the animated NumberFlow aria-hidden so it isn't announced digit-by-digit.
 */
export function AccessibleNumberFlow({
  value,
  format,
  className,
  animated = true,
}: AccessibleNumberFlowProps) {
  const plainText = formatNumber(value, format);
  return (
    <>
      <NumberFlow
        className={className}
        value={value}
        aria-hidden="true"
        locales={i18n.language}
        format={format}
        animated={animated}
      />
      <span className="sr-only">{plainText}</span>
    </>
  );
}
