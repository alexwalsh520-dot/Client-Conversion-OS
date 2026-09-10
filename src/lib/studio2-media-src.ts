// Cloudflare's public R2 bucket domain (pub-*.r2.dev) is DNS-blocked on some
// networks — Indonesian ISPs, for one, hijack every *.r2.dev lookup to the
// Kominfo block page (lamanlabuh.aduankonten.id), which refuses :443. The
// browser then can't load a single Studio 2 image or video even though the
// objects are fine.
//
// Fix: never hand an r2.dev URL straight to an <img>/<video>. Route it through
// our own same-origin proxy (/api/studio-2/media/proxy), which fetches from R2
// server-side and re-serves it off the app's domain. Non-R2 hosts (CloudFront
// AI results, blob:, data:, same-origin paths) are returned untouched — the
// proxy's allowlist would reject them anyway.
const R2_PUBLIC_HOST = /(^|\.)r2\.dev$/i;

export function studio2MediaSrc(src: string): string {
  if (!src || !/^https?:\/\//i.test(src)) return src;
  try {
    const url = new URL(src);
    if (typeof window !== "undefined" && url.origin === window.location.origin) return src;
    if (!R2_PUBLIC_HOST.test(url.hostname)) return src;
    return `/api/studio-2/media/proxy?url=${encodeURIComponent(src)}`;
  } catch {
    return src;
  }
}
