// Icons ported verbatim from the v1 ads export (public/ads-tracker-export.html):
// the shared Icon wrapper (14px, stroke 1.4, viewBox 24) plus the calendar,
// caret, and check glyphs the filter controls use.

function Icon({ d, size = 14, stroke = 1.4 }: { d: React.ReactNode; size?: number; stroke?: number }) {
  return (
    <svg
      className="i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d}
    </svg>
  );
}

export function IcCal() {
  return (
    <Icon
      d={
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </>
      }
    />
  );
}

export function IcCaret() {
  return (
    <svg
      width="9"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}

export function IcCheck() {
  return <Icon d={<path d="M20 6L9 17l-5-5" />} />;
}
