import { useTranslation } from 'react-i18next';

export function WelcomeHero() {
  const { t } = useTranslation('welcome');

  return (
    <section className="flex flex-col gap-7 max-w-xl">
      <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--color-chart-2)' }}
        />
        {t('hero.eyebrow')}
      </span>

      <h1
        className="text-5xl md:text-6xl leading-[1.05] tracking-tight"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {t('hero.headlinePre')}
        <em style={{ color: 'var(--color-primary)' }}>
          {t('hero.headlineEmphasis')}
        </em>
        {t('hero.headlineSuffix')}
      </h1>

      <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
        {t('hero.lede')}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-5">
        <HeroMetric label={t('hero.metrics.offline')} />
        <MetricSeparator />
        <HeroMetric label={t('hero.metrics.methods')} />
        <MetricSeparator />
        <HeroMetric label={t('hero.metrics.ppCompatible')} />
      </div>
    </section>
  );
}

function HeroMetric({ label }: { label: string }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
      {label}
    </span>
  );
}

function MetricSeparator() {
  return (
    <span
      aria-hidden
      className="h-1 w-1 rounded-full shrink-0"
      style={{ background: 'var(--qv-border-strong)' }}
    />
  );
}
