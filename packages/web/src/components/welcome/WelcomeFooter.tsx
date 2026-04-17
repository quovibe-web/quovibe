import { useTranslation } from 'react-i18next';

const DOCS_URL = 'https://github.com/quovibe-web/quovibe#readme';

export function WelcomeFooter() {
  const { t } = useTranslation('welcome');
  const year = new Date().getFullYear();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcutKey = isMac ? t('footer.shortcutsKey') : 'Ctrl K';

  return (
    <footer className="flex items-center justify-between gap-4 border-t px-6 py-5 md:px-10 text-[11px] font-mono text-muted-foreground">
      <span>{t('footer.copyright', { year })}</span>
      <div className="flex items-center gap-5">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground"
        >
          {t('footer.docs')}
        </a>
        <span className="hidden sm:inline-flex items-center gap-1.5">
          {t('footer.shortcutsLabel')}
          <span className="tracking-wider text-[var(--qv-text-faint)]">·</span>
          <kbd className="rounded border border-[var(--qv-border)] bg-card/50 px-1.5 py-0.5 text-[10px]">
            {shortcutKey}
          </kbd>
        </span>
      </div>
    </footer>
  );
}
