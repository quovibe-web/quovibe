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

export type DbUploadError = 'duplicateName' | null;

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
  const [ppDuplicateName, setPpDuplicateName] = useState<string>('');
  const [dbFile, setDbFile] = useState<File | null>(null);
  const [dbName, setDbName] = useState('');
  const [dbUploadError, setDbUploadError] = useState<DbUploadError>(null);
  const [dbDuplicateName, setDbDuplicateName] = useState<string>('');
  const [success, setSuccess] = useState<{
    entry: PortfolioRegistryEntry;
    summary: ImportSummary;
  } | null>(null);

  useEffect(() => { document.title = `${t('hub.title')} · quovibe`; }, [t]);

  const handlePpFile = async (f: File): Promise<void> => {
    setPpUploadError(null);
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
          toast.error(t('hub.errors.importFailed', { msg: resolveErrorMessage(err) }));
        },
      },
    );
  };

  return (
    <main className="qv-page mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-10 md:py-16">
      <Link
        to="/welcome"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        {t('hub.backToWelcome')}
      </Link>

      <header className="flex flex-col gap-2">
        <h1
          className="text-3xl md:text-4xl leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t('hub.title')}
        </h1>
        <p className="text-muted-foreground max-w-xl leading-relaxed">{t('hub.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-4">
        {/* PP XML source */}
        <SourceCard
          icon={FileCode2}
          title={t('hub.sources.ppXml.title')}
          body={t('hub.sources.ppXml.body')}
          accent="var(--color-chart-3)"
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
              accentColor="var(--color-chart-3)"
              file={ppFile}
              onFile={(f) => { void handlePpFile(f); }}
            />
            {ppUploadError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {ppUploadError === 'duplicateName'
                    ? tErrors('portfolio.duplicateName', { name: ppDuplicateName })
                    : t(`hub.errors.${ppUploadError}`)}
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
              className="self-start font-semibold shadow-md transition-all hover:brightness-110 hover:shadow-xl active:scale-[0.98]"
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
          accent="var(--color-chart-1)"
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
              accentColor="var(--color-chart-1)"
              file={dbFile}
              onFile={handleDbFile}
            />
            {dbUploadError === 'duplicateName' && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {tErrors('portfolio.duplicateName', { name: dbDuplicateName })}
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
              className="self-start font-semibold shadow-md transition-all hover:brightness-110 hover:shadow-xl active:scale-[0.98]"
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
        <div className="flex items-start gap-4 rounded-xl border border-dashed bg-card/50 px-5 py-4 text-muted-foreground">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60">
            <FileSpreadsheet size={18} strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="font-medium text-foreground text-sm">{t('hub.sources.csvHint.title')}</h3>
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
  accent: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function SourceCard({ icon: Icon, title, body, accent, open, onToggle, children }: SourceCardProps) {
  const panelId = useId();
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card transition-all duration-200',
        !open && 'qv-card-interactive',
      )}
      style={open ? { borderColor: `color-mix(in srgb, ${accent} 45%, var(--qv-border))` } : undefined}
    >
      {/* Left accent bar — invisible at rest, previews on hover, full when open */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-1 origin-left transition-transform duration-300 ease-out',
          !open && 'scale-x-0 group-hover:scale-x-[0.5] group-focus-within:scale-x-[0.5]',
          open && 'scale-x-100',
        )}
        style={{ background: accent }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-4 px-5 py-4 text-left cursor-pointer transition-colors duration-200"
        style={open ? { background: `color-mix(in srgb, ${accent} 5%, transparent)` } : undefined}
      >
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-all duration-200 group-hover:-translate-y-0.5 group-hover:scale-105"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
        >
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block font-medium transition-colors duration-200"
            style={{ color: open ? accent : undefined }}
          >
            {title}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground leading-snug">{body}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
            'transition-all duration-300',
            !open && 'group-hover:translate-x-0.5',
          )}
          style={{
            transform: open ? 'rotate(90deg)' : undefined,
            borderColor: open
              ? `color-mix(in srgb, ${accent} 40%, transparent)`
              : `color-mix(in srgb, ${accent} 22%, var(--qv-border))`,
            color: open ? accent : 'var(--muted-foreground)',
          }}
        >
          <ChevronRight size={16} />
        </span>
      </button>
      {open && <div id={panelId} className="border-t px-5 pb-5">{children}</div>}
    </div>
  );
}
