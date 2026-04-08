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
import { useInitPortfolio } from '@/api/use-init-portfolio';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';

interface ImportPageProps {
  /** When true, shows the reimport (replace) UI with confirmation checkbox */
  isReimport?: boolean;
  onClose?: () => void;
}

// Inline logo — aperture mark + serif/sans wordmark
function QuovibeLogo({ isLight }: { isLight: boolean }) {
  const strokeColor = isLight ? '#100f0f' : '#cecdc3';
  const mutedColor = isLight ? '#6f6e69' : '#878580';
  const goldColor = isLight ? '#ad8301' : '#d0a215';

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 120 120" fill="none" className="w-12 h-12">
        <path d="M60 22 Q82 22, 82 44" stroke={strokeColor} strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path d="M98 60 Q98 82, 76 82" stroke={strokeColor} strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path d="M60 98 Q38 98, 38 76" stroke={strokeColor} strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path d="M22 60 Q22 38, 44 38" stroke={strokeColor} strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <circle cx="60" cy="60" r="6" fill={goldColor} />
      </svg>
      <span className="text-4xl" style={{ letterSpacing: '-0.5px' }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", color: strokeColor }}>quo</span>
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 300, color: mutedColor }}>vibe</span>
      </span>
    </div>
  );
}

export default function ImportPage({ isReimport = false, onClose }: ImportPageProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { data: portfolio } = usePortfolio();
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
      navigate('/', { replace: true });
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
            action: { label: t('import.goToDashboard'), onClick: () => navigate('/') },
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

  const isLight = resolvedTheme === 'light';

  // First-run mode: branded full-page layout
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden qv-page"
      style={{
        background: isLight
          ? 'linear-gradient(135deg, #d6e8f4 0%, #eaeff9 35%, #f0f3fb 60%, #e8e2f4 100%)'
          : 'var(--qv-bg)',
      }}
    >
      {/* Glow blobs */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-60px',
          left: '-60px',
          width: isLight ? '420px' : '320px',
          height: isLight ? '420px' : '320px',
          borderRadius: '50%',
          background: isLight
            ? 'radial-gradient(circle, rgba(8,145,178,0.30) 0%, transparent 65%)'
            : 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 18%, transparent) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: '-40px',
          right: '-40px',
          width: isLight ? '380px' : '280px',
          height: isLight ? '380px' : '280px',
          borderRadius: '50%',
          background: isLight
            ? 'radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 65%)'
            : 'radial-gradient(circle, color-mix(in srgb, var(--color-chart-5) 18%, transparent) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '250px',
          borderRadius: '50%',
          background: isLight
            ? 'radial-gradient(ellipse, rgba(124,58,237,0.08) 0%, transparent 70%)'
            : 'radial-gradient(ellipse, color-mix(in srgb, var(--color-chart-5) 6%, transparent) 0%, transparent 70%)',
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
      <div className="flex flex-col items-center justify-center mb-8 relative">
        {/* Scanline texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(8,145,178,0.015) 0px, transparent 1px, transparent 3px)',
          }}
        />
        <QuovibeLogo isLight={resolvedTheme === 'light'} />
        <p className="text-sm text-muted-foreground mt-4 tracking-widest font-mono uppercase opacity-50">
          {t('import.tagline')}
        </p>
      </div>

      {/* Two cards */}
      <div className="w-full max-w-2xl flex flex-col sm:flex-row gap-4">
        {/* Card left: Import from XML */}
        <div
          className="flex-1 rounded-xl p-6 space-y-4"
          style={{
            background: isLight ? 'linear-gradient(145deg, #ffffff 0%, #f5f7ff 100%)' : 'var(--qv-surface)',
            border: `1px solid ${isLight ? 'rgba(15,23,42,0.09)' : 'var(--qv-border)'}`,
            boxShadow: isLight
              ? '0 4px 24px rgba(15,23,42,0.10), 0 1px 4px rgba(15,23,42,0.06)'
              : '0 1px 3px rgba(0,0,0,0.3)',
          }}
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
              style={canSubmit && !isActive ? {
                background: 'var(--color-primary)',
                border: 'none',
                color: 'var(--color-primary-foreground)',
              } : undefined}
            >
              {t('import.importButton')}
            </Button>
          </div>
        </div>

        {/* Card right: Start from scratch */}
        <div
          className="flex-1 rounded-xl p-6 flex flex-col items-center justify-center gap-4 text-center"
          style={{
            background: isLight ? 'linear-gradient(145deg, #ffffff 0%, #f5f7ff 100%)' : 'var(--qv-surface)',
            border: `1px solid ${isLight ? 'rgba(15,23,42,0.09)' : 'var(--qv-border)'}`,
            boxShadow: isLight
              ? '0 4px 24px rgba(15,23,42,0.10), 0 1px 4px rgba(15,23,42,0.06)'
              : '0 1px 3px rgba(0,0,0,0.3)',
          }}
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
            style={{
              background: 'var(--color-primary)',
              border: 'none',
              color: 'var(--color-primary-foreground)',
            }}
          >
            {t('import.startButton')}
          </Button>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-8 text-xs text-muted-foreground/50">
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
              onClick={() => navigate('/')}
              className="cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]"
              style={{
                background: 'var(--color-primary)',
                border: 'none',
                color: 'var(--color-primary-foreground)',
              }}
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
              style={{
                background: 'var(--color-primary)',
                border: 'none',
                color: 'var(--color-primary-foreground)',
              }}
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
              onClick={() => navigate('/')}
              className="cursor-pointer transition-all duration-150 hover:brightness-110 hover:saturate-110 active:scale-[0.98]"
              style={{
                background: 'var(--color-primary)',
                border: 'none',
                color: 'var(--color-primary-foreground)',
              }}
            >
              {t('import.goToDashboard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
