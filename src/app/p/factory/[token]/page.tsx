// Public, no-login share view for ONE Factory project.
//
// The token resolves server-side to a single project. Everything this page can
// see comes from /api/public/factory/<token>, which hard-scopes every read and
// write to that one project — there is no route from here to any other project
// or to the rest of CCOS.
import type { Metadata } from "next";
import ShareClient from "./ShareClient";
import "./share.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Ad Review",
  robots: { index: false, follow: false },
};

export default async function PublicFactoryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareClient token={token} />;
}
