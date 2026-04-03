import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ChartExportButtonProps {
  chartRef: RefObject<HTMLDivElement | null>;
  filename: string;
}

export function ChartExportButton({ chartRef, filename }: ChartExportButtonProps) {
  const { t } = useTranslation('performance');
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!chartRef.current || exporting) return;
    setExporting(true);

    try {
      // Get the computed background color from the theme
      const bgColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--qv-bg').trim() || '0 0% 100%';

      const dataUrl = await toPng(chartRef.current, {
        pixelRatio: 2,
        backgroundColor: `hsl(${bgColor})`,
        filter: (node) => {
          // Hide tooltips during export
          if (node instanceof HTMLElement && node.classList.contains('recharts-tooltip-wrapper')) {
            return false;
          }
          return true;
        },
      });

      // Add watermark via canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.drawImage(img, 0, 0);

      // Subtle watermark
      ctx.font = '18px sans-serif';
      ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
      ctx.textAlign = 'right';
      ctx.fillText('quovibe', canvas.width - 16, canvas.height - 12); // native-ok

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (err) {
      console.error('Chart export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('chart.downloadPng')}</TooltipContent>
    </Tooltip>
  );
}
