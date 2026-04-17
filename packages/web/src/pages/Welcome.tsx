import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Sparkles, PlayCircle, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
                <ActionCard
                  accent="primary"
                  icon={Sparkles}
                  title={t('cards.fresh.title')}
                  description={t('cards.fresh.body')}
                  cta={t('cards.fresh.cta')}
                  badge={t('cards.fresh.badge')}
                  disabled={create.isPending}
                  onClick={handleFresh}
                >
                  <Input
                    ref={inputRef}
                    placeholder={t('cards.fresh.namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleFresh();
                      }
                    }}
                    className="mt-1"
                  />
                </ActionCard>
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
