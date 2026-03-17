"use client";

import { Construction, Wrench, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function LeadsPage() {
  return (
    <div className="page-container flex items-center justify-center min-h-[80vh]">
      <div className="glass-card p-12 max-w-lg text-center space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <Construction className="w-16 h-16 text-[var(--gold)]" />
            <Wrench className="w-6 h-6 text-[var(--text-secondary)] absolute -bottom-1 -right-1 rotate-45" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Under Construction
          </h1>
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
            The Lead Gen engine is being rebuilt. Check back soon.
          </p>
        </div>

        <Link
          href="/"
          className="btn-primary inline-flex items-center gap-2 mt-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
