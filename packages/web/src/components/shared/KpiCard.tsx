import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function KpiCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="relative overflow-hidden transition-colors duration-200">
      <CardHeader className="pb-1 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}
