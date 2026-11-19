/** The mark: a heart that is also a plug. The heart takes the text colour, the pulse line cuts through it in --logo-cut. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="20 18 68 72" width={size} height={size * 72 / 68} aria-hidden="true" className="logo-mark">
      <path fill="currentColor" d="M54,86 C30,68 24,56 24,46 C24,38.5 30,34 36.5,34 C44,34 50,39 54,45 C58,39 64,34 71.5,34 C78,34 84,38.5 84,46 C84,56 78,68 54,86 Z" />
      <path fill="currentColor" d="M40.5,22 C42.4,22 44,23.6 44,25.5 L44,38 L37,38 L37,25.5 C37,23.6 38.6,22 40.5,22 Z" />
      <path fill="currentColor" d="M67.5,22 C69.4,22 71,23.6 71,25.5 L71,38 L64,38 L64,25.5 C64,23.6 65.6,22 67.5,22 Z" />
      <path fill="none" stroke="var(--logo-cut, var(--md-sys-color-surface))" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M33,57 L45,57 L50,47.5 L57,67 L62,57 L75,57" />
    </svg>
  );
}
