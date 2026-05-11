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

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const { t } = useTranslation('navigation');
  const version = __APP_VERSION__;
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('help.title')}</DialogTitle>
          <DialogDescription>{t('help.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-muted-foreground" />
              {t('help.about')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('help.aboutBlurb', { version })}
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Keyboard className="h-4 w-4 text-muted-foreground" />
              {t('help.shortcuts')}
            </h3>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('help.shortcutPalette')}</span>
                <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">{modKey} + K</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('help.shortcutSidebar')}</span>
                <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">{modKey} + B</kbd>
              </li>
            </ul>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              {t('help.links')}
            </h3>
            <ul className="space-y-1.5 text-sm">
              <li>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
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
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
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
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
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
