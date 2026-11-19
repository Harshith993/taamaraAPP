/** Brand pieces: the lotus mark (vector redraw of the company logo), the petal stripe and the wordmark. */

const PETALS: [string, string][] = [
  ["#861A41", "M84 68Q40 64 32 20Q76 24 84 68Z"],
  ["#F3C644", "M116 68Q160 64 168 20Q124 24 116 68Z"],
  ["#E8963A", "M100 104Q70 80 76 38Q98 60 100 104Z"],
  ["#F0B13C", "M100 104Q130 80 124 38Q102 60 100 104Z"],
  ["#D84F2F", "M100 2Q113 18 126 34Q113 50 100 66Q87 50 74 34Q87 18 100 2Z"],
  ["#E2A1BB", "M100 104Q62 60 22 58Q44 94 100 104Z"],
  ["#AFC147", "M100 104Q138 60 178 58Q156 94 100 104Z"],
  ["#DD619A", "M100 112Q50 76 2 82Q30 118 100 112Z"],
  ["#85A646", "M100 112Q150 76 198 82Q170 118 100 112Z"],
];

export function LotusMark({ width = 32, gap = "#FFFFFF", title = "Taamara Taamara" }: { width?: number; gap?: string; title?: string }) {
  return (
    <svg width={width} height={(width * 120) / 200} viewBox="0 0 200 120" role="img" aria-label={title}>
      <g stroke={gap} strokeWidth={4} strokeLinejoin="round">
        {PETALS.map(([fill, d]) => (
          <path key={d} fill={fill} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** The lotus on a white disc with a soft shadow. */
export function LotusBadge({ size = 42 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-white shadow-[var(--shadow-card)] ring-1 ring-line" style={{ width: size, height: size }}>
      <LotusMark width={size * 0.76} />
    </span>
  );
}


/** The lotus rainbow as a soft gradient line. */
export function PetalStripe({ height = 3 }: { height?: number }) {
  return <div aria-hidden="true" className="rainbow opacity-80" style={{ height }} />;
}

export function Wordmark({ withTagline = true }: { withTagline?: boolean }) {
  return (
    <span className="flex flex-col leading-none">
      <span className="font-condensed text-[19px] tracking-[-0.02em]">Taamara Taamara</span>
      {withTagline && <span className="mt-[3px] text-[11.5px] font-medium text-ink-quiet">events &amp; beyond</span>}
    </span>
  );
}
