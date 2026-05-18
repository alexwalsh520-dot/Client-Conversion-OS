/* eslint-disable @next/next/no-img-element */
import { getLiveAdsDashboard } from "@/lib/live-ads";
import styles from "./live-ads.module.css";

export const dynamic = "force-dynamic";

function formatCheckedAt(value: string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function totalCampaigns(data: Awaited<ReturnType<typeof getLiveAdsDashboard>>) {
  return data.accounts.reduce((sum, account) => sum + account.campaigns.length, 0);
}

function totalAdSets(data: Awaited<ReturnType<typeof getLiveAdsDashboard>>) {
  return data.accounts.reduce(
    (sum, account) =>
      sum + account.campaigns.reduce((campaignSum, campaign) => campaignSum + campaign.adSets.length, 0),
    0
  );
}

export default async function LiveAdsPage() {
  const data = await getLiveAdsDashboard();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Marketing</p>
          <h1 className={styles.title}>Live Ads</h1>
          <p className={styles.subtitle}>
            Every currently active Meta ad from Tyson and Keith, grouped by campaign and ad set.
          </p>
        </div>
        <div className={styles.syncPill}>Checked {formatCheckedAt(data.checkedAt)} ET</div>
      </header>

      <section className={styles.stats} aria-label="Live ads summary">
        <div className={styles.stat}>
          <span className={styles.statLabel}>Active ads</span>
          <strong className={styles.statValue}>{data.totalActiveAds}</strong>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Campaigns</span>
          <strong className={styles.statValue}>{totalCampaigns(data)}</strong>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Ad sets</span>
          <strong className={styles.statValue}>{totalAdSets(data)}</strong>
        </div>
      </section>

      {data.accounts.map((account) => (
        <section className={styles.accountBlock} key={account.key}>
          <div className={styles.accountHead}>
            <div>
              <h2 className={styles.accountTitle}>{account.name}</h2>
              <p className={styles.accountMeta}>
                {account.activeAdsCount} active ads
                {account.adAccountId ? ` · ${account.adAccountId}` : ""}
              </p>
            </div>
          </div>

          {account.error ? <div className={styles.error}>{account.error}</div> : null}

          {!account.error && account.campaigns.length === 0 ? (
            <div className={styles.empty}>No active ads in this account right now.</div>
          ) : null}

          {account.campaigns.map((campaign) => (
            <article className={styles.campaign} key={campaign.id}>
              <div className={styles.campaignTop}>
                <h3 className={styles.campaignName}>{campaign.name}</h3>
                <span className={styles.activeBadge}>{campaign.status || "ACTIVE"}</span>
              </div>

              {campaign.adSets.map((adSet) => (
                <section className={styles.adSet} key={adSet.id}>
                  <div className={styles.adSetHead}>
                    <div>
                      <p className={styles.adSetLabel}>Ad set</p>
                      <h4 className={styles.adSetName}>{adSet.name}</h4>
                      <p className={styles.adSetSub}>
                        {[adSet.dailyBudget ? `${adSet.dailyBudget}/day` : null, adSet.optimizationGoal, adSet.billingEvent]
                          .filter(Boolean)
                          .join(" · ") || "Budget and delivery details unavailable"}
                      </p>
                    </div>
                    <span className={styles.activeBadge}>{adSet.status || "ACTIVE"}</span>
                  </div>

                  <p className={styles.audienceHeadline}>{adSet.audience.headline}</p>
                  {adSet.audience.chips.length > 0 ? (
                    <div className={styles.chips}>
                      {adSet.audience.chips.map((chip) => (
                        <span className={styles.chip} key={chip}>
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {adSet.audience.raw ? (
                    <details className={styles.rawDetails}>
                      <summary>Raw Meta targeting</summary>
                      <pre>{JSON.stringify(adSet.audience.raw, null, 2)}</pre>
                    </details>
                  ) : null}

                  <div className={styles.adsGrid}>
                    {adSet.ads.map((ad) => (
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
                          {ad.title ? <p className={styles.adCopy}>{ad.title}</p> : null}
                          {ad.body ? <p className={styles.adCopy}>{ad.body}</p> : null}
                          <div className={styles.adFooter}>
                            <span className={styles.miniMeta}>{ad.status}</span>
                            <a className={styles.metaLink} href={ad.metaUrl} target="_blank" rel="noreferrer">
                              Open in Meta
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
