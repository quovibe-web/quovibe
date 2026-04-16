import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sparkles, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ImportDropzone } from '@/components/ImportDropzone';
import { ImportProgress } from '@/components/ImportProgress';
import { useImport } from '@/api/use-import';
import { usePortfolio } from '@/api/use-portfolio';
import { usePortfolio as usePortfolioContext } from '@/context/PortfolioContext';
import { useInitPortfolio } from '@/api/use-init-portfolio';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';

interface ImportPageProps {
  /** When true, shows the reimport (replace) UI with confirmation checkbox */
  isReimport?: boolean;
  onClose?: () => void;
}

// Inline logo — aperture mark + serif/sans wordmark, fully CSS-var driven
function QuovibeLogo() {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 120 120" fill="none" className="w-12 h-12">
        <path d="M60 22 Q82 22, 82 44" stroke="var(--qv-text-primary)" strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path d="M98 60 Q98 82, 76 82" stroke="var(--qv-text-primary)" strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path d="M60 98 Q38 98, 38 76" stroke="var(--qv-text-primary)" strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path d="M22 60 Q22 38, 44 38" stroke="var(--qv-text-primary)" strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <circle cx="60" cy="60" r="6" fill="var(--qv-warning)" />
      </svg>
      <span className="text-4xl" style={{ letterSpacing: '-0.5px' }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--qv-text-primary)' }}>quo</span>
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 300, color: 'var(--qv-text-muted)' }}>vibe</span>
      </span>
    </div>
  );
}

export default function ImportPage({ isReimport = false, onClose }: ImportPageProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { data: portfolio } = usePortfolio();
  const currentPortfolio = usePortfolioContext();
  const dashboardPath = `/p/${currentPortfolio.id}/dashboard`;
  const { state, setFile, submit, reset } = useImport();
  const initMutation = useInitPortfolio();
  const [file, setFileLocal] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showInitSuccessDialog, setShowInitSuccessDialog] = useState(false);
  const [preventRedirect, setPreventRedirect] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  const shouldRedirectAway = !isReimport && !preventRedirect && portfolio !== undefined && !portfolio.empty;

  useEffect(() => {
    if (shouldRedirectAway) {
      navigate(dashboardPath, { replace: true });
    }
  }, [shouldRedirectAway, navigate]);

  const canSubmit = file !== null && (!isReimport || confirmed);
  const isActive = state.stage === 'uploading' || state.stage === 'restarting';

  // Show success dialog after import (first-run only; reimport uses toast)
  useEffect(() => {
    if (state.stage === 'success') {
      setPreventRedirect(true);
      if (onClose) {
        // Reimport: close dialog, show persistent toast
        onClose();
        toast.success(
          t('import.importSuccess', { accounts: state.accounts, securities: state.securities }),
          {
            action: { label: t('import.goToDashboard'), onClick: () => navigate(dashboardPath) },
            duration: Infinity,
          }
        );
      } else {
        // First launch: show the AlertDialog after 1s
        const timer = setTimeout(() => setShowSuccessDialog(true), 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [state.stage, onClose]);

  const lastImport = portfolio?.config?.['portfolio.lastImport'] ?? null;

  function handleFile(f: File) {
    setFileLocal(f);
    setFile(f);
  }

  function handleSubmit() {
    if (file && canSubmit) submit(file);
  }

  if (shouldRedirectAway) {
    return null;
  }

  // Reimport mode: keep existing Card UI, no branding
  if (isReimport) {
    return (
      <div className="p-0">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>{t('import.replaceTitle')}</CardTitle>
            <CardDescription>
              {t('import.replaceDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {lastImport && (
              <p className="text-sm text-muted-foreground">
                {t('import.lastImport')} {lastImport}
              </p>
            )}
            <ImportDropzone onFile={handleFile} disabled={isActive} />
            <div className="flex items-center gap-2">
              <Checkbox
                id="confirm-replace"
                checked={confirmed}
                onCheckedChange={v => setConfirmed(!!v)}
                disabled={isActive}
              />
              <Label htmlFor="confirm-replace" className="text-sm cursor-pointer">
                {t('import.confirmReplace')}
              </Label>
            </div>
            <ImportProgress
              stage={state.stage}
              accounts={state.accounts}
              securities={state.securities}
              errorCode={state.errorCode}
              errorDetails={state.errorDetails}
            />
            <div className="flex justify-between gap-2">
              {state.stage === 'error' && (
                <Button variant="outline" onClick={() => { reset(); if (onClose) onClose(); }}>
                  {t('common:cancel')}
                </Button>
              )}
              <Button
                className="ml-auto"
                disabled={!canSubmit || isActive}
                onClick={handleSubmit}
              >
                {t('import.replaceTitle')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // First-run mode: branded full-page layout using Flexoki tokens
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden qv-page bg-background">

      {/* Warm Flexoki glow blobs — gold top-left, blue bottom-right */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          top: '-80px',
          left: '-80px',
          width: '350px',
          height: '350px',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-chart-7) 10%, transparent) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          bottom: '-60px',
          right: '-60px',
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 8%, transparent) 0%, transparent 70%)',
        }}
      />

      {/* Theme toggle + Language selector */}
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageSwitcher />
        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="rounded-full p-2 transition-colors bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
          aria-label={t('navigation:theme.toggle')}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {/* Hero branding */}
      <div className="flex flex-col items-center justify-center mb-8">
        <div style={{ animation: 'qv-stagger-in 0.4s ease-out both' }}>
          <QuovibeLogo />
        </div>
        <p
          className="text-sm text-muted-foreground mt-4 tracking-widest font-mono uppercase opacity-50"
          style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '100ms' }}
        >
          {t('import.tagline')}
        </p>
      </div>

      {/* Two cards */}
      <div className="w-full max-w-2xl flex flex-col sm:flex-row gap-4">
        {/* Card left: Import from XML */}
        <div
          className="flex-1 rounded-xl p-6 space-y-4 bg-card border border-border"
          data-slot="card"
          style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '150ms' }}
        >
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">
              {t('import.importTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('import.importDescription')}
            </p>
          </div>

          <ImportDropzone onFile={handleFile} disabled={isActive} />

          <ImportProgress
            stage={state.stage}
            accounts={state.accounts}
            securities={state.securities}
            errorCode={state.errorCode}
            errorDetails={state.errorDetails}
          />

          <div className="flex justify-end gap-2">
            {state.stage === 'error' && (
              <Button variant="outline" onClick={() => reset()}>
                {t('common:retry')}
              </Button>
            )}
            <Button
              disabled={!canSubmit || isActive}
              onClick={handleSubmit}
              className={canSubmit && !isActive ? 'cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]' : ''}
            >
              {t('import.importButton')}
            </Button>
          </div>
        </div>

        {/* Card right: Start from scratch */}
        <div
          className="flex-1 rounded-xl p-6 flex flex-col items-center justify-center gap-4 text-center bg-card border border-border"
          data-slot="card"
          style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '200ms' }}
        >
          <Sparkles size={40} style={{ color: 'var(--color-chart-5)' }} />
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">
              {t('import.startFromScratch')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('import.startDescription')}
            </p>
          </div>
          <Button
            onClick={() => setShowInitDialog(true)}
            className="cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]"
          >
            {t('import.startButton')}
          </Button>
        </div>
      </div>

      {/* Footer */}
      <p
        className="mt-8 text-xs text-muted-foreground/50"
        style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '300ms' }}
      >
        {t('import.tagline')}
      </p>

      {/* AlertDialog import success */}
      <AlertDialog open={showSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('import.successTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('import.successMessage', { count: state.accounts, securities: state.securities })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => navigate(dashboardPath)}
              className="cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]"
            >
              {t('import.goToDashboard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog confirm initialization */}
      <AlertDialog open={showInitDialog} onOpenChange={setShowInitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('import.emptyConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('import.emptyConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {initMutation.isError && (
            <p className="text-sm text-destructive">
              {t('import.emptyError')}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={initMutation.isPending}>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={initMutation.isPending}
              onClick={() => {
                initMutation.mutate(undefined, {
                  onSuccess: () => {
                    setPreventRedirect(true);
                    setShowInitDialog(false);
                    setShowInitSuccessDialog(true);
                  },
                });
              }}
              className="cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]"
            >
              {initMutation.isPending ? t('common:waiting') : t('common:confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog init success (start from scratch) */}
      <AlertDialog open={showInitSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('import.initSuccessTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('import.initSuccessDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => navigate(dashboardPath)}
              className="cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]"
            >
              {t('import.goToDashboard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
