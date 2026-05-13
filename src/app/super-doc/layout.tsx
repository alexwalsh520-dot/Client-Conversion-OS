import './super-doc.css';

export default function SuperDocLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Instrument+Serif:ital@1&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
