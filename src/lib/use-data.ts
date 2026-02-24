// Custom hook for loading async data with mock fallback
// Used by "use client" page components to fetch from Supabase

"use client";

import { useState, useEffect, useCallback } from "react";

export function useAsyncData<T>(fetcher: () => Promise<T>, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => setData(result))
      .catch((err) => {
        console.warn("[useAsyncData] Fetch failed, using fallback:", err);
        setError(String(err));
        // Fallback already set as initial state
      })
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[useAsyncData] Fetch failed, using fallback:", err);
          setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, refetch };
}
