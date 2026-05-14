interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4 qv-fade-in">
      {/* Decorative rings behind icon */}
      <div className="relative">
        <div className="absolute inset-0 -m-3 rounded-full bg-[var(--qv-surface-elevated)]" />
        <div className="absolute inset-0 -m-6 rounded-full border border-[var(--qv-border-subtle)]" />
        <Icon className="relative h-12 w-12 opacity-30" />
      </div>
      <div className="text-center space-y-2 mt-2">
        <h3
          className="font-display text-3xl md:text-4xl font-medium text-[var(--qv-text-display)]"
          style={{ fontVariationSettings: '"opsz" 72', letterSpacing: '-0.015em' }}
        >
          {title}
        </h3>
        {description && (
          <p className="text-sm text-[var(--qv-text-secondary)] max-w-md mx-auto">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
