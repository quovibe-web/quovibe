interface SummaryStripItem {
  label: string;
  value: React.ReactNode;
}

interface SummaryStripProps {
  items: SummaryStripItem[];
  columns?: 2 | 3 | 4 | 5;
}

const gridCols: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 md:grid-cols-3',
  4: 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
  5: 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
};

export function SummaryStrip({ items, columns = 3 }: SummaryStripProps) {
  return (
    <div
      className={`grid grid-cols-1 ${gridCols[columns] ?? 'sm:grid-cols-3'} rounded-md border border-border bg-card overflow-hidden`}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={`p-4 ${index > 0 ? 'border-t sm:border-t-0 sm:border-l border-[var(--qv-border-subtle)]' : ''}`}
        >
          <p className="qv-eyebrow">{item.label}</p>
          <div className="mt-2">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
