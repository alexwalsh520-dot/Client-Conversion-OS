"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Database,
  DollarSign,
  Gauge,
  LockKeyhole,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  Zap,
} from "lucide-react";
import type {
  AntiAvatar,
  BrainAvatar,
  BrainOverview,
  BrainTab,
  CampaignBrief,
  CopyPhrase,
  LeadScore,
  WinningAd,
} from "@/lib/marketing-brain/data";

const tabs: Array<{ id: BrainTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "avatars", label: "Avatars", icon: UsersRound },
  { id: "copy", label: "Copy Intel", icon: MessageSquareText },
  { id: "briefs", label: "Briefs", icon: ClipboardList },
  { id: "leads", label: "Lead Scores", icon: Gauge },
  { id: "cost", label: "Cost", icon: DollarSign },
];

const sourceIcon: Record<string, React.ComponentType<{ size?: number }>> = {
  Fathom: PhoneCall,
  "Sales tracker": ClipboardList,
  "Ads Tracker": Megaphone,
  "DM threads": MessageSquareText,
  LTV: TrendingUp,
};

function statusLabel(status: string) {
  return status[0]?.toUpperCase() + status.slice(1);
}

function MetricStrip({ data }: { data: BrainOverview }) {
  return (
    <section className="mb-metrics" aria-label="Brain metrics">
      {data.metrics.map((metric) => (
        <div className={`mb-metric mb-tone-${metric.tone}`} key={metric.label}>
          <div className="mb-metric-label">{metric.label}</div>
          <div className="mb-metric-value">
            {metric.value}
            <span>{metric.unit}</span>
          </div>
          <div className="mb-metric-meta">{metric.meta}</div>
        </div>
      ))}
    </section>
  );
}

function SourceRail({ data }: { data: BrainOverview }) {
  return (
    <section className="mb-source-rail" aria-label="Data sources">
      {data.sources.map((source) => {
        const Icon = sourceIcon[source.name] ?? Database;
        return (
          <div className="mb-source" key={source.name}>
            <div className="mb-source-icon">
              <Icon size={16} />
            </div>
            <div>
              <div className="mb-source-top">
                <span>{source.name}</span>
                <span className={`mb-source-status mb-source-${source.status}`}>
                  {statusLabel(source.status)}
                </span>
              </div>
              <div className="mb-source-detail">{source.detail}</div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function AvatarCard({ avatar }: { avatar: BrainAvatar }) {
  return (
    <article className={`mb-avatar-card mb-avatar-${avatar.color}`}>
      <div className="mb-card-glow" />
      <div className="mb-avatar-head">
        <div className="mb-avatar-glyph">{avatar.glyph}</div>
        <div>
          <h3>{avatar.name}</h3>
          <p>
            {avatar.confidence} - {avatar.calls} calls
          </p>
        </div>
      </div>
      <div className="mb-avatar-stats">
        <div>
          <strong>{avatar.revenue}</strong>
          <span>Revenue</span>
        </div>
        <div>
          <strong>{avatar.closeRate}</strong>
          <span>Close</span>
        </div>
        <div>
          <strong>{avatar.ltv}</strong>
          <span>LTV</span>
        </div>
      </div>
      <div className="mb-chip-row">
        {avatar.traits.map((trait) => (
          <span className="mb-chip" key={trait}>
            {trait}
          </span>
        ))}
      </div>
      <blockquote>{avatar.quote}</blockquote>
      <div className="mb-card-foot">
        <span>{avatar.evidence}</span>
        <span>{avatar.trend}</span>
      </div>
    </article>
  );
}

function AvatarsPanel({ avatars }: { avatars: BrainAvatar[] }) {
  return (
    <section>
      <SectionHead eyebrow="01" title="Who actually buys" meta="Clustered from closed and lost call evidence" />
      <div className="mb-avatar-grid">
        {avatars.map((avatar) => (
          <AvatarCard avatar={avatar} key={avatar.id} />
        ))}
      </div>
    </section>
  );
}

function AntiAvatarList({ antiAvatars }: { antiAvatars: AntiAvatar[] }) {
  return (
    <section className="mb-panel">
      <div className="mb-panel-head">
        <div>
          <div className="mb-eyebrow">02 - Avoid</div>
          <h2>Who wastes the call</h2>
        </div>
        <AlertTriangle size={18} />
      </div>
      <div className="mb-list">
        {antiAvatars.map((anti) => (
          <article className="mb-list-row" key={anti.name}>
            <div className="mb-row-top">
              <strong>{anti.name}</strong>
              <span>
                {anti.calls} calls - {anti.lostRevenue} lost
              </span>
            </div>
            <blockquote>{anti.quote}</blockquote>
            <div className="mb-row-foot">
              <span>{anti.filter}</span>
              <span>{anti.share} of lost revenue</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CopyPhraseList({ phrases }: { phrases: CopyPhrase[] }) {
  return (
    <section className="mb-panel">
      <div className="mb-panel-head">
        <div>
          <div className="mb-eyebrow">03 - Copy intel</div>
          <h2>Words that change cash quality</h2>
        </div>
        <MessageSquareText size={18} />
      </div>
      <div className="mb-list">
        {phrases.map((phrase) => (
          <article className="mb-phrase" key={phrase.phrase}>
            <div>
              <blockquote>{phrase.phrase}</blockquote>
              <span>{phrase.source}</span>
            </div>
            <strong className={phrase.tone === "win" ? "mb-win" : "mb-loss"}>{phrase.result}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function WinningAds({ ads }: { ads: WinningAd[] }) {
  return (
    <section className="mb-panel mb-wide-panel">
      <div className="mb-panel-head">
        <div>
          <div className="mb-eyebrow">04 - Ads ranked by money</div>
          <h2>Hooks that brought buyers, not just leads</h2>
        </div>
        <Megaphone size={18} />
      </div>
      <div className="mb-table-wrap">
        <table className="mb-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Hook</th>
              <th>Avatar</th>
              <th className="mb-num">Spend</th>
              <th className="mb-num">Cash</th>
              <th>Read</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => (
              <tr key={ad.keyword}>
                <td className="mb-keyword">{ad.keyword}</td>
                <td>{ad.hook}</td>
                <td>{ad.avatar}</td>
                <td className="mb-num">{ad.spend}</td>
                <td className="mb-num mb-money">{ad.cash}</td>
                <td>{ad.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BriefCard({ brief }: { brief: CampaignBrief }) {
  return (
    <article className="mb-brief-card">
      <div className="mb-brief-head">
        <div>
          <h3>{brief.title}</h3>
          <p>{brief.avatar}</p>
        </div>
        <span className={`mb-brief-status mb-brief-${brief.status.toLowerCase()}`}>{brief.status}</span>
      </div>
      <p className="mb-brief-summary">{brief.summary}</p>
      <div className="mb-proof">{brief.proof}</div>
      <div className="mb-brief-columns">
        <div>
          <span>Use</span>
          {brief.hooks.map((hook) => (
            <p key={hook}>{hook}</p>
          ))}
        </div>
        <div>
          <span>Avoid</span>
          {brief.avoid.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>
      <div className="mb-creative">{brief.creative}</div>
    </article>
  );
}

function BriefsPanel({ briefs }: { briefs: CampaignBrief[] }) {
  return (
    <section>
      <SectionHead eyebrow="05" title="Briefs ready for the marketing team" meta="Each brief is built from evidence, then approved by a human" />
      <div className="mb-brief-grid">
        {briefs.map((brief) => (
          <BriefCard brief={brief} key={brief.id} />
        ))}
      </div>
    </section>
  );
}

function LeadScoreRow({ lead }: { lead: LeadScore }) {
  const tier = lead.score >= 85 ? "hot" : lead.score >= 70 ? "warm" : "cold";
  return (
    <article className={`mb-lead-row mb-lead-${tier}`}>
      <div className="mb-lead-score">
        <strong>{lead.score}</strong>
        <span>score</span>
      </div>
      <div className="mb-lead-main">
        <div className="mb-lead-top">
          <strong>{lead.name}</strong>
          <span>{lead.time}</span>
        </div>
        <p>
          {lead.avatar} match from {lead.source}
        </p>
        <div className="mb-lead-grid">
          <span>{lead.dmSignal}</span>
          <span>{lead.flag}</span>
          <span>{lead.opener}</span>
        </div>
      </div>
    </article>
  );
}

function LeadScoresPanel({ leads }: { leads: LeadScore[] }) {
  return (
    <section>
      <SectionHead eyebrow="06" title="Today calls, scored before pickup" meta="The closer sees the lead trail before the call starts" />
      <div className="mb-leads">
        {leads.map((lead) => (
          <LeadScoreRow lead={lead} key={lead.name} />
        ))}
      </div>
    </section>
  );
}

function CostPanel({ data }: { data: BrainOverview }) {
  return (
    <section>
      <SectionHead eyebrow="07" title="Cost controls" meta="The Brain only spends when new truth arrives" />
      <div className="mb-cost-grid">
        {data.costControls.map((control) => (
          <article className={`mb-cost-card mb-tone-${control.tone}`} key={control.label}>
            <div className="mb-cost-top">
              <span>{control.label}</span>
              {control.label.includes("Backfill") ? <LockKeyhole size={16} /> : <DollarSign size={16} />}
            </div>
            <strong>{control.value}</strong>
            <p>{control.detail}</p>
          </article>
        ))}
      </div>
      <div className="mb-cost-system">
        <div className="mb-cost-copy">
          <div className="mb-eyebrow">Simple rule</div>
          <h2>Read big files once. Save small facts. Reuse forever.</h2>
          <p>
            Calls, DMs, and ads are expensive only when the Brain reads the full raw text. After that, briefs and lead
            scores use the saved facts, quotes, and outcomes.
          </p>
        </div>
        <div className="mb-rule-list">
          {data.costRules.map((rule) => (
            <article className="mb-rule" key={rule.name}>
              <div>
                <strong>{rule.name}</strong>
                <p>{rule.detail}</p>
              </div>
              <span>{rule.status}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return (
    <div className="mb-section-head">
      <div>
        <div className="mb-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      <span>{meta}</span>
    </div>
  );
}

function Overview({ data }: { data: BrainOverview }) {
  return (
    <div className="mb-tab-stack">
      <MetricStrip data={data} />
      <SourceRail data={data} />
      <AvatarsPanel avatars={data.avatars} />
      <div className="mb-two-col">
        <AntiAvatarList antiAvatars={data.antiAvatars} />
        <CopyPhraseList phrases={data.copyPhrases} />
      </div>
      <WinningAds ads={data.winningAds} />
      <BriefsPanel briefs={data.briefs.slice(0, 2)} />
      <CostPanel data={data} />
    </div>
  );
}

export default function MarketingBrainDashboard({ data }: { data: BrainOverview }) {
  const [activeTab, setActiveTab] = useState<BrainTab>("overview");
  const activeIndex = useMemo(() => tabs.findIndex((tab) => tab.id === activeTab), [activeTab]);

  return (
    <div className="marketing-brain">
      <header className="mb-header">
        <div>
          <div className="mb-kicker">
            <BrainCircuit size={16} />
            Marketing Brain
            <span>Closed loop</span>
          </div>
          <h1>The marketing department memory.</h1>
          <p>
            Ads, DMs, calls, outcomes, and LTV become one simple system: better leads, better calls, better campaigns.
          </p>
        </div>
        <div className="mb-header-actions" aria-label="Brain status">
          <div className="mb-status-pill">
            <ShieldCheck size={15} />
            Preview safe
          </div>
          <div className="mb-status-pill">
            <RefreshCw size={15} />
            Updated {data.updatedAt}
          </div>
        </div>
      </header>

      <div className="mb-loop" aria-label="Marketing loop">
        <span>
          <Megaphone size={15} />
          Ad
        </span>
        <span>
          <MessageSquareText size={15} />
          DM
        </span>
        <span>
          <PhoneCall size={15} />
          Call
        </span>
        <span>
          <CheckCircle2 size={15} />
          Outcome
        </span>
        <span>
          <Sparkles size={15} />
          Better brief
        </span>
      </div>

      <nav className="mb-tabs" aria-label="Marketing Brain sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              className={activeTab === tab.id ? "active" : ""}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
        <div className="mb-tab-indicator" style={{ "--tab-index": activeIndex } as CSSProperties} />
      </nav>

      {activeTab === "overview" && <Overview data={data} />}
      {activeTab === "avatars" && (
        <div className="mb-tab-stack">
          <MetricStrip data={data} />
          <AvatarsPanel avatars={data.avatars} />
          <div className="mb-two-col">
            <AntiAvatarList antiAvatars={data.antiAvatars} />
            <LeadScoresPanel leads={data.leadScores.slice(0, 2)} />
          </div>
        </div>
      )}
      {activeTab === "copy" && (
        <div className="mb-tab-stack">
          <div className="mb-two-col">
            <CopyPhraseList phrases={data.copyPhrases} />
            <AntiAvatarList antiAvatars={data.antiAvatars.slice(0, 3)} />
          </div>
          <WinningAds ads={data.winningAds} />
        </div>
      )}
      {activeTab === "briefs" && (
        <div className="mb-tab-stack">
          <BriefsPanel briefs={data.briefs} />
          <div className="mb-build-path">
            <Target size={20} />
            <div>
              <strong>Approval path</strong>
              <p>Brief gets approved, then moves downstream to Campaign Launcher. The Brain does not publish ads.</p>
            </div>
            <Zap size={20} />
          </div>
        </div>
      )}
      {activeTab === "leads" && (
        <div className="mb-tab-stack">
          <LeadScoresPanel leads={data.leadScores} />
          <SourceRail data={data} />
        </div>
      )}
      {activeTab === "cost" && (
        <div className="mb-tab-stack">
          <CostPanel data={data} />
        </div>
      )}
    </div>
  );
}
