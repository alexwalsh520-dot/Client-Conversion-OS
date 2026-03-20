'use client';

import { useState } from 'react';

interface DetailsToggleProps {
  children: React.ReactNode;
}

export function DetailsToggle({ children }: DetailsToggleProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <DetailsButton open={open} onClick={() => setOpen(!open)} />
      {open && <div>{children}</div>}
    </>
  );
}

export function DetailsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-all duration-150"
      style={{
        padding: '5px 12px',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        color: open ? 'var(--gold)' : 'var(--text-3)',
        border: open ? '1px solid rgba(201,169,110,0.3)' : '1px solid var(--border)',
        background: open ? 'var(--gold-bg)' : 'transparent',
      }}
    >
      Details
    </button>
  );
}

export function TopBarWithDetails({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
