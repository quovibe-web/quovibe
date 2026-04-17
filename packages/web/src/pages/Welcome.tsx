import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Sparkles, PlayCircle, Download, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/shared/SubmitButton';
import { useCreatePortfolio } from '@/api/use-portfolios';
import { WelcomeBackground } from '@/components/welcome/WelcomeBackground';
import { WelcomeTopBar } from '@/components/welcome/WelcomeTopBar';
import { WelcomeHero } from '@/components/welcome/WelcomeHero';
import { WelcomeFooter } from '@/components/welcome/WelcomeFooter';
import { ActionCard } from '@/components/welcome/ActionCard';

const STAGGER_DELAYS = {
  hero: '0ms',
  card1: '120ms',
  card2: '220ms',
  card3: '320ms',
} as const;

export default function Welcome() {
  const { t } = useTranslation('welcome');
  const navigate = useNavigate();
  const create = useCreatePortfolio();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'quovibe';
  }, []);

  const handleDemo = (): void => {
    create.mutate(
      { source: 'demo' },
      {
        onSuccess: (r) => navigate(`/p/${r.entry.id}/dashboard`),
        onError: (err) =>
          toast.error(t('errors.demoFailed', { msg: (err as Error).message })),
      },
    );
  };

  const handleFresh = (): void => {
    if (!name.trim()) {
      inputRef.current?.focus();
      return;
    }
    create.mutate(
      { source: 'fresh', name: name.trim() },
      {
        onSuccess: (r) => navigate(`/p/${r.entry.id}/dashboard`),
        onError: (err) =>
          toast.error(t('errors.createFailed', { msg: (err as Error).message })),
      },
    );
  };

  return (
    <>
      <WelcomeBackground />
      <div className="flex min-h-svh flex-col">
        <WelcomeTopBar />
        <main className="flex-1 px-6 py-8 md:px-10 md:py-14">
          <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1.1fr_1fr] md:gap-16 lg:gap-24">
            <div
              className="qv-stagger-fade"
              style={{ animationDelay: STAGGER_DELAYS.hero }}
            >
              <WelcomeHero />
            </div>
            <div className="flex flex-col gap-4">
              <div
                className="qv-stagger-fade"
                style={{ animationDelay: STAGGER_DELAYS.card1 }}
              >
                {/* Fresh card — bespoke markup so the Input + SubmitButton are valid interactive children */}
                <div
                  className="qv-card-interactive group relative flex w-full items-start gap-4 overflow-hidden rounded-xl border bg-card px-5 py-5 text-left"
                >
                  {/* Accent bar */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1 origin-center scale-y-[0.3] transition-transform duration-300 ease-out group-hover:scale-y-100 group-focus-within:scale-y-100"
                    style={{ background: 'var(--color-primary)' }}
                  />
                  {/* Icon */}
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
                      color: 'var(--color-primary)',
                    }}
                  >
                    <Sparkles size={20} strokeWidth={1.75} />
                  </span>
                  {/* Content */}
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-lg leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                        {t('cards.fresh.title')}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                        style={{
                          color: 'var(--color-primary)',
                          background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                        }}
                      >
                        {t('cards.fresh.badge')}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground leading-snug">{t('cards.fresh.body')}</span>
                    <span className="mt-1 block">
                      <Input
                        ref={inputRef}
                        placeholder={t('cards.fresh.namePlaceholder')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleFresh();
                          }
                        }}
                        className="mt-1"
                      />
                    </span>
                    <SubmitButton
                      mutation={create}
                      onClick={handleFresh}
                      className="mt-2 inline-flex items-center gap-1.5 self-start text-sm font-medium"
                      variant="ghost"
                      size="sm"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {t('cards.fresh.cta')}
                    </SubmitButton>
                  </span>
                  {/* Arrow */}
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full border transition-all duration-200 group-hover:translate-x-0.5 group-hover:border-transparent"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 40%, transparent)' }}
                  >
                    <ArrowRight size={16} className="transition-colors" style={{ color: 'var(--color-primary)' }} />
                  </span>
                </div>
              </div>
              <div
                className="qv-stagger-fade"
                style={{ animationDelay: STAGGER_DELAYS.card2 }}
              >
                <ActionCard
                  accent="teal"
                  icon={PlayCircle}
                  title={t('cards.demo.title')}
                  description={t('cards.demo.body')}
                  cta={t('cards.demo.cta')}
                  badge={t('cards.demo.badge')}
                  disabled={create.isPending}
                  onClick={handleDemo}
                />
              </div>
              <div
                className="qv-stagger-fade"
                style={{ animationDelay: STAGGER_DELAYS.card3 }}
              >
                <ActionCard
                  accent="orange"
                  icon={Download}
                  title={t('cards.import.title')}
                  description={t('cards.import.body')}
                  cta={t('cards.import.cta')}
                  badge={t('cards.import.badge')}
                  onClick={() => navigate('/import')}
                />
              </div>
            </div>
          </div>
        </main>
        <WelcomeFooter />
      </div>
    </>
  );
}
