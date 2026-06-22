"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState, type ReactNode } from "react";
import type {
  LiveAdsAdSetGroup,
  LiveAdsCampaignGroup,
  LiveAdsPayload,
} from "@/lib/live-ads";
import styles from "./live-ads.module.css";

interface Selection {
  accountKey: string;
  campaignId: string;
  adSetId: string;
}

type ViewMode = "campaigns" | "leaderboard";

function formatCheckedAt(value: string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function totalCampaigns(data: LiveAdsPayload) {
  return data.accounts.reduce((sum, account) => sum + account.campaigns.length, 0);
}

function totalAdSets(data: LiveAdsPayload) {
  return data.accounts.reduce(
    (sum, account) =>
      sum + account.campaigns.reduce((campaignSum, campaign) => campaignSum + campaign.adSets.length, 0),
    0
  );
}

function firstSelection(data: LiveAdsPayload): Selection | null {
  for (const account of data.accounts) {
    for (const campaign of account.campaigns) {
      const adSet = campaign.adSets[0];
      if (adSet) {
        return {
          accountKey: account.key,
          campaignId: campaign.id,
          adSetId: adSet.id,
        };
      }
    }
  }
  return null;
}

function adCount(campaign: LiveAdsCampaignGroup) {
  return campaign.adSets.reduce((sum, adSet) => sum + adSet.ads.length, 0);
}

function findSelected(data: LiveAdsPayload, selection: Selection | null) {
  if (!selection) return null;
  const account = data.accounts.find((item) => item.key === selection.accountKey);
  const campaign = account?.campaigns.find((item) => item.id === selection.campaignId);
  const adSet = campaign?.adSets.find((item) => item.id === selection.adSetId);
  if (!account || !campaign || !adSet) return null;
  return { account, campaign, adSet };
}

function adSetMeta(adSet: LiveAdsAdSetGroup) {
  return [
    adSet.dailyBudget ? `${adSet.dailyBudget}/day` : null,
    adSet.optimizationGoal ? adSet.optimizationGoal.toLowerCase().replaceAll("_", " ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function LiveAdsBrowser({
  data,
  headerSlot,
}: {
  data: LiveAdsPayload;
  /** Operator-only affordance rendered in the header (e.g. the Share button). */
  headerSlot?: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection | null>(() => firstSelection(data));
  const [viewMode, setViewMode] = useState<ViewMode>("campaigns");
  const selected = useMemo(() => findSelected(data, selection), [data, selection]);
  const leaderboardAds = useMemo(
    () =>
      data.accounts
        .flatMap((account) =>
          account.campaigns.flatMap((campaign) =>
            campaign.adSets.flatMap((adSet) =>
              adSet.ads.map((ad) => ({
                ...ad,
                accountName: account.name,
                accountKey: account.key,
                campaignName: campaign.name,
                adSetName: adSet.name,
              }))
            )
          )
        )
        .sort((a, b) => b.spendLast7d - a.spendLast7d || a.name.localeCompare(b.name)),
    [data]
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Marketing</p>
          <h1 className={styles.title}>Live Ads</h1>
          <p className={styles.summaryLine}>
            {data.totalActiveAds} active ads across {totalCampaigns(data)} campaigns
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.viewToggle} aria-label="Live ads view">
            <button
              type="button"
              className={viewMode === "campaigns" ? styles.viewToggleActive : ""}
              onClick={() => setViewMode("campaigns")}
            >
              Campaigns
            </button>
            <button
              type="button"
              className={viewMode === "leaderboard" ? styles.viewToggleActive : ""}
              onClick={() => setViewMode("leaderboard")}
            >
              Leaderboard
            </button>
          </div>
          <div className={styles.syncPill}>Checked {formatCheckedAt(data.checkedAt)} ET</div>
          {headerSlot}
        </div>
      </header>

      {viewMode === "leaderboard" ? (
        <section className={styles.leaderboardPanel}>
          <div className={styles.leaderboardHeader}>
            <div>
              <p className={styles.selectedEyebrow}>{data.spendWindowLabel}</p>
              <h2 className={styles.selectedTitle}>Spend leaderboard</h2>
            </div>
            <span className={styles.activeBadge}>{leaderboardAds.length} active ads</span>
          </div>

          <div className={styles.leaderboardList}>
            {leaderboardAds.map((ad, index) => (
              <article className={styles.leaderboardRow} key={ad.id}>
                <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                <div
                  className={styles.leaderCreative}
                >
                  {ad.thumbnailUrl ? <img src={ad.thumbnailUrl} alt="" loading="lazy" /> : null}
                </div>
                {ad.thumbnailUrl ? (
                  <div className={styles.leaderPreview}>
                    <img src={ad.thumbnailUrl} alt="" loading="lazy" />
                  </div>
                ) : null}
                <div className={styles.leaderMain}>
                  <h3>{ad.name}</h3>
                  <p>
                    {ad.accountName} · {ad.campaignName.replace(`${ad.accountName} · `, "")} · {ad.adSetName}
                  </p>
                </div>
                <div className={styles.leaderSpend}>
                  <span>{data.spendWindowLabel}</span>
                  <strong>{formatCurrency(ad.spendLast7d)}</strong>
                </div>
                <a className={styles.metaLink} href={ad.metaUrl} target="_blank" rel="noreferrer">
                  Open in Meta
                </a>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.browserShell}>
        <aside className={styles.navPanel} aria-label="Live ads navigation">
          <div className={styles.navPanelHeader}>
            <span>Campaigns</span>
            <span>{totalAdSets(data)} ad sets</span>
          </div>

          {data.accounts.map((account) => (
            <section className={styles.navAccount} key={account.key}>
              <div className={styles.navAccountHead}>
                <span>{account.name}</span>
                <span>{account.activeAdsCount}</span>
              </div>

              {account.error ? <div className={styles.error}>{account.error}</div> : null}

              {!account.error && account.campaigns.length === 0 ? (
                <div className={styles.emptySmall}>No active ads right now.</div>
              ) : null}

              {account.campaigns.map((campaign) => {
                const campaignSelected =
                  selection?.accountKey === account.key && selection?.campaignId === campaign.id;
                return (
                  <div className={styles.navCampaign} key={campaign.id}>
                    <button
                      type="button"
                      className={`${styles.navCampaignButton} ${campaignSelected ? styles.navCampaignButtonActive : ""}`}
                      onClick={() =>
                        setSelection({
                          accountKey: account.key,
                          campaignId: campaign.id,
                          adSetId: campaign.adSets[0]?.id || "",
                        })
                      }
                    >
                      <span className={styles.navCampaignTitle}>{campaign.name}</span>
                      <span className={styles.navCampaignMeta}>{campaign.adSets.length} ad sets · {adCount(campaign)} ads</span>
                    </button>

                    {campaignSelected ? (
                      <div className={styles.navAdSets}>
                        {campaign.adSets.map((adSet) => {
                          const adSetSelected = selection?.adSetId === adSet.id;
                          return (
                            <button
                              type="button"
                              className={`${styles.navAdSetButton} ${adSetSelected ? styles.navAdSetButtonActive : ""}`}
                              key={adSet.id}
                              onClick={() =>
                                setSelection({
                                  accountKey: account.key,
                                  campaignId: campaign.id,
                                  adSetId: adSet.id,
                                })
                              }
                            >
                              <span>{adSet.name}</span>
                              <span>{adSet.ads.length} ads</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
        </aside>

        <section className={styles.contentPanel}>
          {!selected ? (
            <div className={styles.empty}>No active ads are available right now.</div>
          ) : (
            <>
              <div className={styles.selectedHeader}>
                <div>
                  <p className={styles.selectedEyebrow}>
                    {selected.account.name} · {selected.adSet.ads.length} active ads
                  </p>
                  <h2 className={styles.selectedTitle}>{selected.adSet.name}</h2>
                  <p className={styles.selectedMeta}>{selected.campaign.name}</p>
                </div>
                {adSetMeta(selected.adSet) ? <span className={styles.activeBadge}>{adSetMeta(selected.adSet)}</span> : null}
              </div>

              <details className={styles.targetingDetails}>
                <summary>
                  <span>Targeting details</span>
                  <span>{selected.adSet.audience.headline}</span>
                </summary>
                {selected.adSet.audience.chips.length > 0 ? (
                  <div className={styles.chips}>
                    {selected.adSet.audience.chips.map((chip) => (
                      <span className={styles.chip} key={chip}>
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
                {selected.adSet.audience.raw ? (
                  <details className={styles.rawDetails}>
                    <summary>Raw Meta targeting</summary>
                    <pre>{JSON.stringify(selected.adSet.audience.raw, null, 2)}</pre>
                  </details>
                ) : null}
              </details>

              <div className={styles.adsGrid}>
                {selected.adSet.ads.map((ad) => (
                  <article className={styles.adCard} key={ad.id}>
                    <div className={styles.creative}>
                      {ad.thumbnailUrl ? (
                        <img src={ad.thumbnailUrl} alt="" loading="lazy" />
                      ) : (
                        <div className={styles.creativeMissing}>No creative preview</div>
                      )}
                    </div>
                    <div className={styles.adBody}>
                      <h5 className={styles.adName}>{ad.name}</h5>
                      <div className={styles.adFooter}>
                        <a className={styles.metaLink} href={ad.metaUrl} target="_blank" rel="noreferrer">
                          Open in Meta
                        </a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      )}
    </main>
  );
}
