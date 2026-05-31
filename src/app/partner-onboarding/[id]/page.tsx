"use client";

import { use } from "react";
import ClientDetail from "@/components/onboarding/ClientDetail";

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ClientDetail partnerId={id} />;
}
