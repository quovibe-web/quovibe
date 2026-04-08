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
        <div className="absolute inset-0 -m-3 rounded-full bg-muted/50" />
        <div className="absolute inset-0 -m-6 rounded-full border border-border/50" />
        <Icon className="relative h-12 w-12 opacity-30" />
      </div>
      <div className="text-center space-y-1.5 mt-2">
        <p className="text-sm font-medium text-foreground/70">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground/60 max-w-[280px]">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
