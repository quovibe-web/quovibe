import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/use-theme';
import logoForLightBg from '@/assets/logo/logo.svg';
import logoForDarkBg from '@/assets/logo/logo-light.svg';

export function WelcomeTopBar() {
  const { t } = useTranslation('welcome');
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === 'dark' ? logoForDarkBg : logoForLightBg;
  const version = __APP_VERSION__;

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-5 md:px-10 md:py-6">
      <div className="flex items-center gap-3">
        <img src={logoSrc} alt="quovibe" className="h-9 w-auto md:h-10" />
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="hidden sm:inline-flex items-center gap-2 font-mono">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: 'var(--qv-success)' }}
            />
            <span
              className="absolute -inset-1 rounded-full opacity-40 animate-pulse"
              style={{ background: 'var(--qv-success)' }}
            />
          </span>
          {t('topbar.status')}
        </span>
        <span className="font-mono tracking-wider text-[11px] text-[var(--qv-text-faint)]">
          {t('topbar.versionPrefix')}{version.replace(/^v/, '')}
        </span>
      </div>
    </header>
  );
}
