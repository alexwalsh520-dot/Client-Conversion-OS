'use client';

import { useState } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

export default function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="sd-faq-item">
          <button
            className="sd-faq-q"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            <span>{item.question}</span>
            <svg
              className={`sd-faq-chevron ${openIndex === i ? 'open' : ''}`}
              width="20" height="20" viewBox="0 0 20 20" fill="none"
            >
              <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {openIndex === i && (
            <div className="sd-faq-a">{item.answer}</div>
          )}
        </div>
      ))}
    </div>
  );
}
