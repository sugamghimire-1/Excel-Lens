import { useId } from 'react';

/** The product mark: a lens over a grid, with the cells under the glass enlarged. */
export function Logo({ size = 24 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <mask id={`${id}m`}>
        <rect width="32" height="32" fill="#fff" />
        <circle cx="19.5" cy="19.5" r="10.6" fill="#000" />
      </mask>
      <clipPath id={`${id}c`}>
        <circle cx="19.5" cy="19.5" r="7" />
      </clipPath>
      <g mask={`url(#${id}m)`}>
        <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="rgb(var(--accent))" />
        <path d="M9.8 1.5v25M18.2 1.5v25M1.5 9.8h25M1.5 18.2h25" stroke="rgb(var(--accent-ink))" strokeOpacity="0.5" strokeWidth="1.7" />
      </g>
      <circle cx="19.5" cy="19.5" r="7.6" fill="rgb(var(--panel))" />
      <g clipPath={`url(#${id}c)`}>
        <path d="M12 12h6.6v6.6H12z" fill="#12a594" />
        <path d="M20.4 12H27v6.6h-6.6zM12 20.4h6.6V27H12z" fill="#8fb0f5" />
        <path d="M20.4 20.4H27V27h-6.6z" fill="#f2a20c" />
      </g>
      <circle cx="19.5" cy="19.5" r="7.9" stroke="rgb(var(--ink))" strokeWidth="2.2" />
      <path d="M25.6 25.6l3.9 3.9" stroke="rgb(var(--ink))" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  );
}
