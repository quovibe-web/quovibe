import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ImportStage } from '@/api/use-import';
import { getErrorMessage } from '@/api/use-import';

interface ImportProgressProps {
  stage: ImportStage;
  accounts?: number;
  securities?: number;
  errorCode?: string;
  errorDetails?: string;
}

export function ImportProgress({ stage, accounts, securities, errorCode, errorDetails }: ImportProgressProps) {
  const { t } = useTranslation('settings');

  if (stage === 'idle' || stage === 'ready') return null;

  if (stage === 'uploading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('import.converting')}
      </div>
    );
  }

  if (stage === 'restarting') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('import.restarting', { accounts, securities })}
      </div>
    );
  }

  if (stage === 'success') {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--qv-success)]">
        <CheckCircle2 className="h-4 w-4" />
        {t('import.importSuccess', { accounts, securities })}
      </div>
    );
  }

  if (stage === 'timeout') {
    return (
      <Alert variant="destructive">
        <Clock className="h-4 w-4" />
        <AlertDescription>
          {t('import.serverNotResponding')}
        </AlertDescription>
      </Alert>
    );
  }

  if (stage === 'error') {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{getErrorMessage(errorCode, errorDetails)}</AlertDescription>
      </Alert>
    );
  }

  return null;
}
