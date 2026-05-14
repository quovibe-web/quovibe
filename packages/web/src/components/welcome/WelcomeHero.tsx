import { useTranslation } from 'react-i18next';

export function WelcomeHero() {
  const { t } = useTranslation('welcome');

  return (
    <section className="flex max-w-xl flex-col gap-7">
      <span className="qv-eyebrow inline-flex items-center gap-2">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
        />
        {t('hero.eyebrow')}
      </span>

      <h1
        className="text-5xl leading-[1.05] tracking-tight text-[var(--qv-text-display)] md:text-6xl"
        style={{
          fontFamily: 'var(--font-display)',
          fontVariationSettings: '"opsz" 144',
          fontWeight: 500,
          letterSpacing: '-0.02em',
        }}
      >
        {t('hero.headlinePre')}
        <em className="text-[var(--color-primary)]">
          {t('hero.headlineEmphasis')}
        </em>
        {t('hero.headlineSuffix')}
      </h1>

      <p className="max-w-lg text-lg leading-relaxed text-[var(--qv-text-secondary)]">
        {t('hero.lede')}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--qv-border-subtle)] pt-5">
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
  return <span className="qv-eyebrow">{label}</span>;
}

function MetricSeparator() {
  return (
    <span
      aria-hidden
      className="h-1 w-1 shrink-0 rounded-full bg-[var(--qv-border-strong)]"
    />
  );
}
