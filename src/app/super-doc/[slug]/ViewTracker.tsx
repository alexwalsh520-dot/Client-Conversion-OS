'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    playerjs?: {
      Player: new (element: HTMLIFrameElement | string) => {
        on: (event: string, callback: (data?: { seconds?: number; duration?: number }) => void) => void;
      };
    };
  }
}

function track(slug: string, eventType: string, eventData: Record<string, unknown> = {}) {
  return fetch('/api/super-doc/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      event_type: eventType,
      event_data: eventData,
    }),
  }).catch(() => {});
}

function loadBunnyPlayerScript() {
  const src = 'https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js';
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Bunny Player.js failed to load'));
    document.head.appendChild(script);
  });
}

export default function ViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    track(slug, 'open');
  }, [slug]);

  useEffect(() => {
    const sent = new Set<number>();
    const thresholds = [25, 50, 75, 90, 100];

    const onScroll = () => {
      const doc = document.documentElement;
      const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
      const percent = Math.min(100, Math.round((window.scrollY / maxScroll) * 100));
      const nextThreshold = thresholds.find((threshold) => percent >= threshold && !sent.has(threshold));
      if (!nextThreshold) return;
      sent.add(nextThreshold);
      track(slug, 'read_progress', { percent: nextThreshold });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const progressSent = new Set<number>();
    const progressThresholds = [10, 25, 50, 75, 90, 100];

    loadBunnyPlayerScript()
      .then(() => {
        if (cancelled || !window.playerjs?.Player) return;
        const iframe = document.querySelector<HTMLIFrameElement>('[data-super-doc-video="hero"]');
        if (!iframe) return;

        const player = new window.playerjs.Player(iframe);
        player.on('play', () => {
          track(slug, 'video_play');
        });
        player.on('timeupdate', (data) => {
          const duration = Number(data?.duration || 0);
          const seconds = Number(data?.seconds || 0);
          if (!duration || !seconds) return;
          const percent = Math.min(100, Math.round((seconds / duration) * 100));
          const nextThreshold = progressThresholds.find((threshold) => percent >= threshold && !progressSent.has(threshold));
          if (!nextThreshold) return;
          progressSent.add(nextThreshold);
          track(slug, 'video_progress', { percent: nextThreshold, seconds, duration });
        });
        player.on('pause', (data) => {
          const duration = Number(data?.duration || 0);
          const seconds = Number(data?.seconds || 0);
          const percent = duration ? Math.min(100, Math.round((seconds / duration) * 100)) : 0;
          track(slug, 'video_pause', { percent, seconds, duration });
        });
        player.on('ended', (data) => {
          track(slug, 'video_complete', {
            percent: 100,
            seconds: data?.seconds || data?.duration || 0,
            duration: data?.duration || 0,
          });
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return null;
}
