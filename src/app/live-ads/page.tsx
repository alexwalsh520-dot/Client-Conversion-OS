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
  const firstOpenCampaignId = data.accounts.flatMap((account) => account.campaigns)[0]?.id;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Marketing</p>
          <h1 className={styles.title}>Live Ads</h1>
          <p className={styles.summaryLine}>
            {data.totalActiveAds} active ads · {totalCampaigns(data)} campaigns · {totalAdSets(data)} ad sets
          </p>
        </div>
        <div className={styles.syncPill}>Checked {formatCheckedAt(data.checkedAt)} ET</div>
      </header>

      {data.accounts.map((account) => (
        <section className={styles.accountBlock} key={account.key}>
          <div className={styles.accountHead}>
            <div>
              <h2 className={styles.accountTitle}>{account.name}</h2>
              <p className={styles.accountMeta}>{account.activeAdsCount} active ads</p>
            </div>
          </div>

          {account.error ? <div className={styles.error}>{account.error}</div> : null}

          {!account.error && account.campaigns.length === 0 ? (
            <div className={styles.empty}>No active ads in this account right now.</div>
          ) : null}

          {account.campaigns.map((campaign) => (
            <details className={styles.campaign} key={campaign.id} open={campaign.id === firstOpenCampaignId}>
              <summary className={styles.campaignTop}>
                <div>
                  <h3 className={styles.campaignName}>{campaign.name}</h3>
                  <p className={styles.rowMeta}>
                    {campaign.adSets.length} ad sets ·{" "}
                    {campaign.adSets.reduce((sum, adSet) => sum + adSet.ads.length, 0)} active ads
                  </p>
                </div>
                <span className={styles.activeBadge}>{campaign.status || "ACTIVE"}</span>
              </summary>

              {campaign.adSets.map((adSet) => (
                <details className={styles.adSet} key={adSet.id}>
                  <summary className={styles.adSetHead}>
                    <div>
                      <p className={styles.adSetLabel}>Ad set</p>
                      <h4 className={styles.adSetName}>{adSet.name}</h4>
                      <p className={styles.adSetSub}>
                        {[adSet.dailyBudget ? `${adSet.dailyBudget}/day` : null, adSet.optimizationGoal ? `Optimizing for ${adSet.optimizationGoal.toLowerCase().replaceAll("_", " ")}` : null]
                          .filter(Boolean)
                          .join(" · ") || "Budget and delivery details unavailable"}
                      </p>
                    </div>
                    <span className={styles.rowMeta}>{adSet.ads.length} ads</span>
                  </summary>

                  <details className={styles.targetingDetails}>
                    <summary>
                      <span>Targeting details</span>
                      <span>Audience, placements, and raw Meta settings</span>
                    </summary>
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
                  </details>

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
                </details>
              ))}
            </details>
          ))}
        </section>
      ))}
    </main>
  );
}
