/** Four tiles of a mosaic: the product mark. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="15" height="11" rx="2.5" fill="rgb(var(--accent))" />
      <rect x="20.5" y="3" width="8.5" height="11" rx="2.5" fill="#12a594" />
      <rect x="3" y="16.5" width="8.5" height="12.5" rx="2.5" fill="#e5a50a" />
      <rect x="14" y="16.5" width="15" height="12.5" rx="2.5" fill="rgb(var(--accent))" />
    </svg>
  );
}
