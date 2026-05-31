import { useEffect, useId, useState } from 'react';
import type React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, FileCode2, DatabaseBackup, FileSpreadsheet, Loader2, ChevronRight, Upload } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/shared/SubmitButton';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/PageHeader';
import { ImportDropzone } from '@/components/ImportDropzone';
import { useCreatePortfolio, type PortfolioRegistryEntry } from '@/api/use-portfolios';
import { ApiError } from '@/api/fetch';
import { resolveErrorMessage } from '@/api/query-client';
import { cn } from '@/lib/utils';
import { sniffLikelyXml } from '@quovibe/shared';
import type { ImportSummary } from '@quovibe/shared';
import { ImportSuccessDialog } from '@/components/domain/import/ImportSuccessDialog';
import { ImportLoadingOverlay } from '@/components/domain/import/ImportLoadingOverlay';

// 4 KB is enough to catch binary content in magic-byte regions without
// blocking on large uploads. Mirrors CsvUploadStep's BINARY_SNIFF_BYTES.
const XML_SNIFF_BYTES = 4096; // native-ok

export type PpUploadError =
  | 'invalidFile'
  | 'tooLarge'
  | 'binary'
  | 'invalidFormat'
  | 'encrypted'
  | 'invalidXml'
  | 'importInProgress'
  | 'conversionFailed'
  | 'duplicateName'
  | null;

export type DbUploadError = 'duplicateName' | 'tooLarge' | null;

async function validateXmlClientSide(file: File): Promise<PpUploadError> {
  if (!file.name.toLowerCase().endsWith('.xml')) return 'invalidFile';
  const slice = file.slice(0, XML_SNIFF_BYTES);
  const text = await slice.text();
  const sniff = sniffLikelyXml(text);
  if (sniff.ok) return null;
  return sniff.reason === 'NOT_TEXT' ? 'binary' : 'invalidFile';
}

/**
 * Full code table matches `.claude/rules/xml-import.md` — any code documented
 * there must produce a non-null PpUploadError so the inline <Alert> renders.
 * DUPLICATE_NAME is included (BUG-PRE14-03): the inline alert improves
 * discoverability over a transient toast; the user can recover by typing a
 * non-colliding name in the rename input without losing the file.
 */
export function mapServerError(code: string): PpUploadError {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return 'tooLarge';
    case 'INVALID_FILE_FORMAT':
    case 'NO_FILE':
      return 'invalidFile';
    case 'INVALID_XML':
      return 'invalidXml';
    case 'INVALID_FORMAT':
      return 'invalidFormat';
    case 'ENCRYPTED_FORMAT':
      return 'encrypted';
    case 'IMPORT_IN_PROGRESS':
      return 'importInProgress';
    case 'CONVERSION_FAILED':
      return 'conversionFailed';
    case 'DUPLICATE_NAME':
      return 'duplicateName';
    default:
      return null;
  }
}

type SourceId = 'pp-xml' | 'quovibe-db';

export default function ImportHub() {
  const { t } = useTranslation('welcome');
  const { t: tErrors } = useTranslation('errors');
  const navigate = useNavigate();
  const create = useCreatePortfolio();

  const [openSource, setOpenSource] = useState<SourceId | null>(null);
  const [ppFile, setPpFile] = useState<File | null>(null);
  const [ppName, setPpName] = useState('');
  const [ppUploadError, setPpUploadError] = useState<PpUploadError>(null);
  const [ppUploadMaxMb, setPpUploadMaxMb] = useState<number | undefined>(undefined);
  const [ppDuplicateName, setPpDuplicateName] = useState<string>('');
  const [dbFile, setDbFile] = useState<File | null>(null);
  const [dbName, setDbName] = useState('');
  const [dbUploadError, setDbUploadError] = useState<DbUploadError>(null);
  const [dbUploadMaxMb, setDbUploadMaxMb] = useState<number | undefined>(undefined);
  const [dbDuplicateName, setDbDuplicateName] = useState<string>('');
  const [success, setSuccess] = useState<{
    entry: PortfolioRegistryEntry;
    summary: ImportSummary;
  } | null>(null);

  useEffect(() => { document.title = `${t('hub.title')} · quovibe`; }, [t]);

  const handlePpFile = async (f: File): Promise<void> => {
    setPpUploadError(null);
    setPpUploadMaxMb(undefined);
    setPpDuplicateName('');
    const rejected = await validateXmlClientSide(f);
    if (rejected) {
      setPpFile(null);
      setPpUploadError(rejected);
      return;
    }
    setPpFile(f);
  };

  const handleDbFile = (f: File): void => {
    setDbUploadError(null);
    setDbUploadMaxMb(undefined);
    setDbDuplicateName('');
    setDbFile(f);
  };

  // Resolve the display name for a DUPLICATE_NAME error: prefer the actual
  // conflicting registry entry that the server echoes in the 409 body
  // (BUG-PRE14-04). Fall back to the user-supplied / filename-derived
  // attempted name when the server omits it (older API builds).
  const resolveDuplicateName = (err: ApiError, fallback: string): string => {
    const serverName = err.details?.['name'];
    return typeof serverName === 'string' && serverName.trim().length > 0
      ? serverName
      : fallback;
  };

  const handleImportPP = (): void => {
    if (!ppFile) {
      toast.error(t('hub.errors.fileRequired'));
      return;
    }
    // Mirror the server's derivation in routes/import.ts so the inline
    // DUPLICATE_NAME alert can interpolate the attempted name when the
    // server's 409 body omits the resolved registry name.
    const attemptedName =
      ppName.trim() ||
      ppFile.name.replace(/\.xml$/i, '').slice(0, 100) ||
      'Imported Portfolio';
    setPpUploadError(null);
    setPpDuplicateName('');
    create.mutate(
      { source: 'import-pp-xml', file: ppFile, name: ppName.trim() || undefined },
      {
        onSuccess: (r) => {
          if (!r.summary) {
            navigate(`/p/${r.entry.id}/dashboard`);
            return;
          }
          setSuccess({ entry: r.entry, summary: r.summary });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
            setPpDuplicateName(resolveDuplicateName(err, attemptedName));
            setPpUploadError('duplicateName');
            return;
          }
          if (err instanceof ApiError) {
            const mapped = mapServerError(err.code);
            if (mapped) {
              if (err.code === 'FILE_TOO_LARGE' && typeof err.details?.['maxMb'] === 'number') {
                setPpUploadMaxMb(err.details['maxMb'] as number);
              }
              setPpUploadError(mapped);
              return;
            }
          }
          toast.error(t('hub.errors.importFailed', { msg: resolveErrorMessage(err) }));
        },
      },
    );
  };

  const handleImportDb = (): void => {
    if (!dbFile) {
      toast.error(t('hub.errors.fileRequired'));
      return;
    }
    // When the rename input is empty the server falls back to the source's
    // vf_portfolio_meta name; surface DUPLICATE_NAME with that fallback so
    // the inline alert tells the user which name actually collided.
    const attemptedName =
      dbName.trim() ||
      dbFile.name.replace(/\.db$/i, '').slice(0, 100) ||
      'Imported Portfolio';
    setDbUploadError(null);
    setDbDuplicateName('');
    create.mutate(
      { source: 'import-quovibe-db', file: dbFile, name: dbName.trim() || undefined },
      {
        onSuccess: (r) => {
          if (!r.summary) {
            navigate(`/p/${r.entry.id}/dashboard`);
            return;
          }
          setSuccess({ entry: r.entry, summary: r.summary });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
            setDbDuplicateName(resolveDuplicateName(err, attemptedName));
            setDbUploadError('duplicateName');
            return;
          }
          if (err instanceof ApiError && err.code === 'FILE_TOO_LARGE') {
            if (typeof err.details?.['maxMb'] === 'number') {
              setDbUploadMaxMb(err.details['maxMb'] as number);
            }
            setDbUploadError('tooLarge');
            return;
          }
          toast.error(t('hub.errors.importFailed', { msg: resolveErrorMessage(err) }));
        },
      },
    );
  };

  return (
    <main className="qv-page mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-10 md:py-16">
      <Link
        to="/welcome"
        className="inline-flex items-center gap-2 text-sm text-[var(--qv-text-secondary)] transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        {t('hub.backToWelcome')}
      </Link>

      <PageHeader title={t('hub.title')} subtitle={t('hub.subtitle')} />

      <div className="flex flex-col gap-4">
        {/* PP XML source */}
        <SourceCard
          icon={FileCode2}
          title={t('hub.sources.ppXml.title')}
          body={t('hub.sources.ppXml.body')}
          open={openSource === 'pp-xml'}
          onToggle={() => setOpenSource(openSource === 'pp-xml' ? null : 'pp-xml')}
        >
          <div className="relative flex flex-col gap-4 pt-4">
            <ImportLoadingOverlay
              visible={create.isPending && create.variables?.source === 'import-pp-xml'}
              label={t('hub.importing')}
            />
            <ImportDropzone
              accept=".xml"
              emptyText={t('hub.sources.ppXml.pickFile')}
              changeHint={t('hub.fileChangeHint')}
              file={ppFile}
              onFile={(f) => { void handlePpFile(f); }}
            />
            {ppUploadError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {ppUploadError === 'duplicateName'
                    ? tErrors('portfolio.duplicateName', { name: ppDuplicateName })
                    : t(`hub.errors.${ppUploadError}`, { maxMb: ppUploadMaxMb })}
                </AlertDescription>
              </Alert>
            )}
            <Input
              type="text"
              placeholder={t('hub.sources.ppXml.nameOptional')}
              value={ppName}
              onChange={(e) => {
                setPpName(e.target.value);
                if (ppUploadError === 'duplicateName') {
                  setPpUploadError(null);
                  setPpDuplicateName('');
                }
              }}
            />
            <SubmitButton
              mutation={create}
              onClick={handleImportPP}
              disabled={!ppFile || (ppUploadError != null && ppUploadError !== 'duplicateName')}
              size="lg"
              className="self-start"
            >
              <Upload className="h-4 w-4" aria-hidden />
              {t('hub.sources.ppXml.submit')}
            </SubmitButton>
          </div>
        </SourceCard>

        {/* .db restore source */}
        <SourceCard
          icon={DatabaseBackup}
          title={t('hub.sources.quovibeDb.title')}
          body={t('hub.sources.quovibeDb.body')}
          open={openSource === 'quovibe-db'}
          onToggle={() => setOpenSource(openSource === 'quovibe-db' ? null : 'quovibe-db')}
        >
          <div className="relative flex flex-col gap-4 pt-4">
            <ImportLoadingOverlay
              visible={create.isPending && create.variables?.source === 'import-quovibe-db'}
              label={t('hub.importing')}
            />
            <ImportDropzone
              accept=".db"
              emptyText={t('hub.sources.quovibeDb.pickFile')}
              changeHint={t('hub.fileChangeHint')}
              file={dbFile}
              onFile={handleDbFile}
            />
            {dbUploadError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {dbUploadError === 'duplicateName'
                    ? tErrors('portfolio.duplicateName', { name: dbDuplicateName })
                    : t(`hub.errors.${dbUploadError}`, { maxMb: dbUploadMaxMb })}
                </AlertDescription>
              </Alert>
            )}
            <Input
              type="text"
              placeholder={t('hub.sources.quovibeDb.nameOptional')}
              value={dbName}
              onChange={(e) => {
                setDbName(e.target.value);
                if (dbUploadError === 'duplicateName') {
                  setDbUploadError(null);
                  setDbDuplicateName('');
                }
              }}
            />
            <Button
              onClick={handleImportDb}
              disabled={!dbFile || create.isPending}
              size="lg"
              className="self-start"
            >
              {create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              {t('hub.sources.quovibeDb.submit')}
            </Button>
          </div>
        </SourceCard>

        {/* CSV hint — muted, not interactive */}
        <div className="flex items-start gap-4 rounded-md border border-dashed border-[var(--qv-border-subtle)] bg-[var(--qv-surface-elevated)] px-5 py-4 text-[var(--qv-text-secondary)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--qv-surface-3)]">
            <FileSpreadsheet size={18} strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-foreground">{t('hub.sources.csvHint.title')}</h3>
            <p className="text-sm leading-snug">{t('hub.sources.csvHint.body')}</p>
          </div>
        </div>
      </div>

      <ImportSuccessDialog
        open={success !== null}
        portfolioName={success?.entry.name ?? ''}
        summary={success?.summary ?? { accounts: 0, securities: 0, transactions: 0 }}
        onConfirm={() => {
          if (success) navigate(`/p/${success.entry.id}/dashboard`);
        }}
      />
    </main>
  );
}

interface SourceCardProps {
  icon: React.ElementType;
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function SourceCard({ icon: Icon, title, body, open, onToggle, children }: SourceCardProps) {
  const panelId = useId();
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-md border bg-card transition-colors duration-200',
        open
          ? 'border-[var(--qv-border-strong)]'
          : 'qv-card-interactive border-[var(--qv-border-subtle)]',
      )}
    >
      {/* Left primary rail — previews on hover, full when open */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[2px] origin-left bg-[var(--color-primary)] transition-transform duration-300 ease-out',
          !open && 'scale-x-0 group-hover:scale-x-100 group-focus-within:scale-x-100',
          open && 'scale-x-100',
        )}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left"
      >
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--qv-surface-elevated)] text-[var(--color-primary)] transition-transform duration-200 group-hover:-translate-y-0.5"
        >
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-[var(--qv-text-display)]">
            {title}
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-[var(--qv-text-secondary)]">
            {body}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--qv-border)] text-[var(--qv-text-secondary)]',
            'transition-transform duration-300',
            !open && 'group-hover:translate-x-0.5',
            open && 'rotate-90 border-[var(--color-primary)] text-[var(--color-primary)]',
          )}
        >
          <ChevronRight size={16} />
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          className="border-t border-[var(--qv-border-subtle)] px-5 pb-5"
        >
          {children}
        </div>
      )}
    </div>
  );
}
