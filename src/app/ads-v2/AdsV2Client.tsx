"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rangeForPreset, todayEt, type DayRange, type PresetId } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Level, AdsV2Payload, AdsV2Status } from "@/lib/ads-v2/types";
import { AccountDropdown, DateDropdown, StatusSegmented } from "./controls";
import CampaignTable from "./CampaignTable";
import MetricsBoard from "./MetricsBoard";
import SettingsGear from "./SettingsGear";
import AccuracyBadge from "./AccuracyBadge";
import AttributionPlus from "./AttributionPlus";

function keyOf(account: AdsV2Account, status: AdsV2Status, range: DayRange): string {
  return `${account}|${status}|${range.from}|${range.to}`;
}

// In public (share-link) mode the token locks the client server-side, so there
// is no account dropdown and every fetch goes through the token-scoped public
// API. Everything else (table, levels, sorting, hovers, popups, colors, speed)
// is identical to the authed tab.
export interface AdsV2ClientProps {
  publicToken?: string;
  lockedAccount?: AdsV2Account;
}

export default function AdsV2Client({ publicToken, lockedAccount }: AdsV2ClientProps = {}) {
  const isPublic = !!publicToken;
  const [account, setAccount] = useState<AdsV2Account>(lockedAccount ?? "all");
  const [status, setStatus] = useState<AdsV2Status>("active");
  const [level, setLevel] = useState<AdsV2Level>("campaign");
  const [preset, setPreset] = useState<PresetId>("last7");
  const [range, setRange] = useState<DayRange>(() => rangeForPreset("last7", todayEt()));

  const [payload, setPayload] = useState<AdsV2Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cache = useRef<Map<string, AdsV2Payload>>(new Map());
  // Guard against a slow response for a stale selection overwriting a newer one.
  const activeKey = useRef<string>("");
  // Counts background revalidations of the ACTIVE window that came back
  // "preparing" (the server was mid-rebuild after a sync bumped data_version).
  // Non-zero keeps the poll effect below re-reading until the rebuilt snapshot
  // lands; without it the table pins to the old snapshot while the Metrics
  // slice moves to the new version, and the board blanks on the version gate.
  const [rebuildPending, setRebuildPending] = useState(0);

  const fetchWindow = useCallback(
    async (acc: AdsV2Account, st: AdsV2Status, r: DayRange, opts?: { background?: boolean }) => {
      const key = keyOf(acc, st, r);
      // Public mode: the token derives the client server-side, so we send no
      // account. Authed mode: the account is a request param as before.
      const url = isPublic
        ? `/api/public/ads-v2/${publicToken}?status=${st}&dateFrom=${r.from}&dateTo=${r.to}`
        : `/api/ads-v2?account=${acc}&status=${st}&dateFrom=${r.from}&dateTo=${r.to}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as AdsV2Payload;
        // Never cache a "preparing" placeholder as if it were the real numbers;
        // that would pin the window to the placeholder on the instant-switch path.
        if (!data.preparing) cache.current.set(key, data);
        // Paint whenever this is still the selection the user is looking at.
        // A background revalidate paints too when it brings REAL data: leaving
        // it cache-only kept the table on the older snapshot version while the
        // Metrics slice fetched the newer one, and the version-pairing gate
        // then blanked the whole Metrics board and the Beyond-the-ads lanes.
        if (activeKey.current === key) {
          if (!data.preparing) {
            setPayload(data);
            setLoading(false);
            setError(null);
            setRebuildPending(0);
          } else if (opts?.background) {
            // Mid-rebuild placeholder: keep showing the cached table, but keep
            // polling until the fresh snapshot lands.
            setRebuildPending((n) => n + 1);
          } else {
            setPayload(data);
            setLoading(false);
            setError(null);
          }
        }
        return data;
      } catch (err) {
        if (!opts?.background && activeKey.current === key) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
        return null;
      }
    },
    [isPublic, publicToken],
  );

  // Load on selection change: cached shows instantly + revalidates; else loads.
  useEffect(() => {
    const key = keyOf(account, status, range);
    activeKey.current = key;
    setRebuildPending(0);
    const cached = cache.current.get(key);
    if (cached) {
      setPayload(cached);
      setLoading(false);
      setError(null);
      fetchWindow(account, status, range, { background: true }); // revalidate
    } else {
      setLoading(true);
      setPayload(null);
      fetchWindow(account, status, range);
    }
  }, [account, status, range, fetchWindow]);

  // After first paint, warm adjacent accounts + presets so switching is instant.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      // Public mode is locked to one client, so only warm presets (no accounts).
      const accounts: AdsV2Account[] = isPublic ? [] : ["all", "tyson", "jake"];
      for (const acc of accounts) {
        if (acc !== account) {
          const k = keyOf(acc, status, range);
          if (!cache.current.has(k)) fetchWindow(acc, status, range, { background: true });
        }
      }
      const presets: PresetId[] = ["today", "last7", "last30"];
      for (const p of presets) {
        const r = rangeForPreset(p, todayEt());
        const k = keyOf(account, status, r);
        if (!cache.current.has(k)) fetchWindow(account, status, r, { background: true });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [loading, account, status, range, fetchWindow, isPublic]);

  // If the window is still preparing (no snapshot yet), or a background
  // revalidate caught the server mid-rebuild, poll until the snapshot lands.
  // The background build was scheduled by the request; we just re-read.
  useEffect(() => {
    if (!payload?.preparing && rebuildPending === 0) return;
    const timer = setTimeout(() => {
      fetchWindow(account, status, range, rebuildPending > 0 ? { background: true } : undefined);
    }, 2500);
    return () => clearTimeout(timer);
  }, [payload, rebuildPending, account, status, range, fetchWindow]);

  const applyDate = (p: PresetId, r: DayRange) => {
    setPreset(p);
    setRange(r);
  };

  return (
    <div className="adsv2 adsv2-page">
      <div className="av2-head">
        <div>
          <div className="av2-title">
            Ads<span className="av2-tag">v2</span>
          </div>
        </div>
        <div className="av2-head-actions">
          <div className="av2-actions-row">
            {!isPublic && <AccuracyBadge payload={payload} />}
            <SettingsGear payload={payload} publicMode={isPublic} publicToken={publicToken} />
          </div>
          {!isPublic && <AttributionPlus />}
        </div>
      </div>

      <div className="filter-bar">
        {!isPublic && <AccountDropdown value={account} onChange={setAccount} />}
        <StatusSegmented value={status} onChange={setStatus} />
        <span className="filter-divider" />
        <DateDropdown preset={preset} range={range} onApply={applyDate} />
      </div>

      {payload && !payload.preparing
        ? payload.notices?.map((n, i) => (
            <div className="notice-bar" key={i}>
              {n}
            </div>
          ))
        : null}

      {loading ? (
        <div className="panel">
          <div className="loading">Loading paid ads...</div>
        </div>
      ) : error ? (
        <div className="panel">
          <div className="empty-state">Could not load: {error}</div>
        </div>
      ) : payload?.preparing ? (
        <div className="panel">
          <div className="preparing-state">
            Preparing this window<span className="dots">...</span>
            <br />
            It will appear in a moment.
          </div>
        </div>
      ) : payload && payload.campaigns.length > 0 ? (
        <>
          <CampaignTable payload={payload} level={level} onLevelChange={setLevel} readOnly={isPublic} />
          <MetricsBoard
            publicToken={publicToken}
            account={account}
            status={status}
            dateFrom={range.from}
            dateTo={range.to}
            tableVersion={payload.dataVersion}
          />
        </>
      ) : (
        <div className="panel">
          <div className="empty-state">
            No paid ad data for this view.
            {account === "jake" ? " No ad data yet for Jake." : ""}
          </div>
        </div>
      )}
    </div>
  );
}
