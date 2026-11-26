export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 10.5l5 5L18 4" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

export function CrossIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 4l12 12M16 4L4 16" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

export function InfoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 8.5v6M10 5v2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
