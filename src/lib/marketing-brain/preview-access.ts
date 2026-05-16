export function isMarketingBrainPath(pathname: string | null | undefined) {
  return pathname === "/marketing-brain" || Boolean(pathname?.startsWith("/marketing-brain/"));
}

export function allowsMarketingBrainPreviewAccess(pathname: string | null | undefined) {
  if (!isMarketingBrainPath(pathname)) return false;

  const explicitPreview = process.env.NEXT_PUBLIC_MARKETING_BRAIN_PREVIEW === "true";
  const vercelPreview = process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const localDevelopment = process.env.NODE_ENV === "development";

  return explicitPreview || vercelPreview || localDevelopment;
}
