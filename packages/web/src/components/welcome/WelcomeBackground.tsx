export function WelcomeBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundImage: [
          // Cool blue bloom top-left
          'radial-gradient(ellipse 60% 50% at 10% 0%, color-mix(in srgb, var(--color-chart-1) 8%, transparent) 0%, transparent 60%)',
          // Warm orange bloom bottom-right
          'radial-gradient(ellipse 55% 45% at 90% 100%, color-mix(in srgb, var(--color-chart-3) 7%, transparent) 0%, transparent 60%)',
          // Dot grid (masked via pseudo-element below)
        ].join(','),
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(circle, color-mix(in srgb, var(--qv-text-faint) 40%, transparent) 1px, transparent 1.5px)',
          backgroundSize: '22px 22px',
          WebkitMaskImage:
            'radial-gradient(ellipse 60% 60% at center, black 30%, transparent 85%)',
          maskImage:
            'radial-gradient(ellipse 60% 60% at center, black 30%, transparent 85%)',
        }}
      />
    </div>
  );
}
