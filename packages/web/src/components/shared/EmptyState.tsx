interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Icon className="h-10 w-10 opacity-25" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70">{description}</p>}
      {action}
    </div>
  );
}
