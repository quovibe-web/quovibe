import { useTranslation } from 'react-i18next';

const DOCS_URL = 'https://github.com/quovibe-web/quovibe#readme';

export function WelcomeFooter() {
  const { t } = useTranslation('welcome');
  const year = new Date().getFullYear();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcutKey = isMac ? t('footer.shortcutsKey') : 'Ctrl K';

  return (
    <footer className="flex items-center justify-between gap-4 border-t border-[var(--qv-border-subtle)] px-6 py-5 md:px-10">
      <span className="qv-eyebrow">{t('footer.copyright', { year })}</span>
      <div className="flex items-center gap-5">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="qv-eyebrow text-[var(--qv-text-secondary)] transition-colors hover:text-foreground"
        >
          {t('footer.docs')}
        </a>
        <span className="qv-eyebrow hidden items-center gap-1.5 sm:inline-flex">
          {t('footer.shortcutsLabel')}
          <span className="text-[var(--qv-text-faint)]">·</span>
          <kbd className="qv-numeric rounded-sm border border-[var(--qv-border-subtle)] bg-[var(--qv-surface-elevated)] px-1.5 py-0.5 text-[10px]">
            {shortcutKey}
          </kbd>
        </span>
      </div>
    </footer>
  );
}
