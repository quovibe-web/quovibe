import { useTranslation } from 'react-i18next';
import { ExternalLink, Keyboard, Info, LinkIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

const GITHUB_URL = 'https://github.com/quovibe-web/quovibe';
const RELEASES_URL = `${GITHUB_URL}/releases`;
const ISSUES_URL = `${GITHUB_URL}/issues/new`;
const DOCS_URL = `${GITHUB_URL}#readme`;

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type UserAgentDataNavigator = Navigator & {
  userAgentData?: { platform?: string };
};

function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as UserAgentDataNavigator;
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /Mac|iPhone|iPad/i.test(platform);
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const { t } = useTranslation('navigation');
  const version = __APP_VERSION__;
  const modKey = detectIsMac() ? '⌘' : 'Ctrl';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('help.title')}</DialogTitle>
          <DialogDescription>{t('help.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <section>
            <h3 className="mb-2 flex items-center gap-2 qv-eyebrow text-[var(--qv-text-faint)]">
              <Info className="h-3 w-3 text-muted-foreground" />
              {t('help.about')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('help.aboutBlurb', { version })}
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-2 qv-eyebrow text-[var(--qv-text-faint)]">
              <Keyboard className="h-3 w-3 text-muted-foreground" />
              {t('help.shortcuts')}
            </h3>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('help.shortcutPalette')}</span>
                <kbd className="rounded-sm border border-[var(--qv-border-subtle)] bg-[var(--qv-surface-elevated)] px-2 py-0.5 text-xs qv-numeric">{modKey} + K</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('help.shortcutSidebar')}</span>
                <kbd className="rounded-sm border border-[var(--qv-border-subtle)] bg-[var(--qv-surface-elevated)] px-2 py-0.5 text-xs qv-numeric">{modKey} + B</kbd>
              </li>
            </ul>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-2 qv-eyebrow text-[var(--qv-text-faint)]">
              <LinkIcon className="h-3 w-3 text-muted-foreground" />
              {t('help.links')}
            </h3>
            <ul className="space-y-1.5 text-sm">
              <li>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline underline-offset-[3px]"
                >
                  {t('help.docs')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${RELEASES_URL}/tag/${version}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline underline-offset-[3px]"
                >
                  {t('help.releaseNotes')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href={ISSUES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline underline-offset-[3px]"
                >
                  {t('help.reportBug')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
