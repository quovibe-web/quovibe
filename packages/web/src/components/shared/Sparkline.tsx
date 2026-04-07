import { useRef, useEffect } from 'react';

interface SparklineProps {
  data: number[];
  width: number;
  height: number;
  color: string;
  fillOpacity?: number;
  className?: string;
}

export function Sparkline({ data, width, height, color, fillOpacity = 0, className }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1; // native-ok
    canvas.width = width * dpr; // native-ok
    canvas.height = height * dpr; // native-ok
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height); // native-ok

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 1; // native-ok

    const xStep = (width - padding * 2) / (data.length - 1); // native-ok
    const yScale = (height - padding * 2) / range; // native-ok

    // Build path
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) { // native-ok
      const x = padding + i * xStep; // native-ok
      const y = padding + (max - data[i]) * yScale; // native-ok
      if (i === 0) ctx.moveTo(x, y); // native-ok
      else ctx.lineTo(x, y);
    }

    // Fill area if requested
    if (fillOpacity > 0) {
      ctx.save();
      const lastX = padding + (data.length - 1) * xStep; // native-ok
      ctx.lineTo(lastX, height);
      ctx.lineTo(padding, height);
      ctx.closePath();
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      // Redraw stroke path
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) { // native-ok
        const x = padding + i * xStep; // native-ok
        const y = padding + (max - data[i]) * yScale; // native-ok
        if (i === 0) ctx.moveTo(x, y); // native-ok
        else ctx.lineTo(x, y);
      }
    }

    // Stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [data, width, height, color, fillOpacity]);

  if (data.length < 2) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width, height }}
    />
  );
}
