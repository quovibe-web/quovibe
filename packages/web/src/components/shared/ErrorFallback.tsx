import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useTranslation('errors');

  let message: string | undefined;
  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-16 text-muted-foreground gap-4">
      <AlertTriangle className="h-12 w-12 opacity-30" />
      <p className="text-base font-medium text-foreground">{t('boundary.title')}</p>
      <p className="text-sm text-muted-foreground/80 max-w-md text-center">
        {t('boundary.description')}
      </p>
      {message && (
        <p className="text-xs text-muted-foreground/60 font-mono max-w-md text-center break-all">
          {message}
        </p>
      )}
      <div className="flex gap-2 mt-2">
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          {t('boundary.reload')}
        </Button>
        <Button variant="default" size="sm" onClick={() => navigate('/')}>
          {t('boundary.goHome')}
        </Button>
      </div>
    </div>
  );
}
