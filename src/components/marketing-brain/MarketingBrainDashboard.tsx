"use client";

import { useState } from "react";
import type {
  AntiAvatar,
  Avatar,
  BrainTab,
  CallHistory,
  CampaignBrief,
  DecisionRule,
  LibraryTab,
  MarketingBrainData,
  NeuralEdge,
  NeuralNode,
  PeopleTab,
  ReceiptBlock,
  UpcomingCall,
  Verdict,
} from "@/lib/marketing-brain/data";

type ModalState =
  | { kind: "verdict"; item: Verdict }
  | { kind: "avatar"; item: Avatar }
  | { kind: "anti"; item: AntiAvatar }
  | { kind: "brief"; item: CampaignBrief }
  | { kind: "call"; item: CallHistory | UpcomingCall }
  | { kind: "rule"; item: DecisionRule }
  | { kind: "newRule" }
  | { kind: "cost" }
  | null;

const brainTabs: Array<{ id: BrainTab; label: string }> = [
  { id: "verdicts", label: "Verdicts" },
  { id: "precall", label: "Pre-call briefs" },
  { id: "library", label: "All data" },
  { id: "rules", label: "Decision rules" },
  { id: "neural", label: "Neural network" },
];

const libraryTabs: Array<{ id: LibraryTab; label: string }> = [
  { id: "people", label: "People" },
  { id: "calls", label: "Calls" },
  { id: "phrases", label: "Phrases" },
  { id: "ads", label: "Ads" },
  { id: "briefs", label: "Briefs" },
  { id: "trends", label: "Trends" },
];

function scoreTier(score: number) {
  if (score >= 86) return "hot";
  if (score >= 70) return "warm";
  return "cold";
}

function verdictLabel(type: Verdict["type"]) {
  return type.toUpperCase();
}

function TabCount({ count }: { count?: number }) {
  if (count === undefined) return null;
  return <span className="mb-count">{count}</span>;
}

function PaneHead({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="mb-pane-head">
      <div>
        <h1>{title}</h1>
        <div className="mb-pane-sub">{sub}</div>
      </div>
      {action}
    </div>
  );
}

function VerdictsPane({ data, open }: { data: MarketingBrainData; open: (modal: ModalState) => void }) {
  return (
    <section>
      <PaneHead title="Verdicts" sub="What the brain thinks you should do this week" />
      <div className="mb-verdicts-feed">
        {data.verdicts.map((verdict) => (
          <button className="mb-verdict" key={verdict.id} onClick={() => open({ kind: "verdict", item: verdict })}>
            <div className="mb-v-head">
              <span className={`mb-v-tag ${verdict.type}`}>{verdictLabel(verdict.type)}</span>
              <span className="mb-v-when">{verdict.when}</span>
            </div>
            <div className="mb-v-claim">{verdict.claim}</div>
            <div className="mb-v-why">{verdict.why}</div>
            <div className="mb-v-foot">
              <span>{verdict.basis}</span>
              <span>Open receipts</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function PrecallPane({ data, open }: { data: MarketingBrainData; open: (modal: ModalState) => void }) {
  return (
    <section>
      <PaneHead title="Pre-call briefs" sub="Today's booked calls - click any to read the full packet" />
      <div className="mb-precall-list">
        {data.upcoming.map((call) => (
          <button className={`mb-pc-row ${scoreTier(call.score)}`} key={call.name} onClick={() => open({ kind: "call", item: call })}>
            <div className="mb-pc-time">{call.time}</div>
            <div className="mb-pc-score">{call.score}</div>
            <div className="mb-pc-person">
              <div className="mb-pc-name">{call.name}</div>
              <div className="mb-pc-meta">
                From <span>{call.source}</span>
              </div>
            </div>
            <div className="mb-pc-avatar">{call.avatar}</div>
            <div className="mb-pc-arrow">-&gt;</div>
            <div className="mb-pc-angle">{call.angle}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function PeoplePane({ data, peopleTab, setPeopleTab, open }: {
  data: MarketingBrainData;
  peopleTab: PeopleTab;
  setPeopleTab: (tab: PeopleTab) => void;
  open: (modal: ModalState) => void;
}) {
  const showingBuyers = peopleTab === "buyers";
  return (
    <div>
      <div className="mb-sub-toggle">
        <button className={showingBuyers ? "active" : ""} onClick={() => setPeopleTab("buyers")} type="button">
          Buyers <TabCount count={data.avatars.length} />
        </button>
        <button className={!showingBuyers ? "active" : ""} onClick={() => setPeopleTab("filter")} type="button">
          Filter out <TabCount count={data.antiAvatars.length} />
        </button>
      </div>
      <div className="mb-card-grid">
        {showingBuyers
          ? data.avatars.map((avatar) => (
              <button className="mb-card gold" key={avatar.id} onClick={() => open({ kind: "avatar", item: avatar })}>
                <div className="mb-card-head">
                  <div>
                    <div className="mb-card-title">{avatar.name}</div>
                    <div className="mb-card-tag">{avatar.calls} calls - #{avatar.rank} LTV</div>
                  </div>
                  <div className="mb-card-stat">
                    <span>{avatar.revenue}</span>
                    <small>revenue</small>
                  </div>
                </div>
                <p>{avatar.desc}</p>
                <div className="mb-card-foot">
                  <span>{avatar.closeRate}% close</span>
                  <span>Open</span>
                </div>
              </button>
            ))
          : data.antiAvatars.map((anti) => (
              <button className="mb-card red" key={anti.id} onClick={() => open({ kind: "anti", item: anti })}>
                <div className="mb-card-head">
                  <div>
                    <div className="mb-card-title">{anti.name}</div>
                    <div className="mb-card-tag">{anti.calls} calls</div>
                  </div>
                  <div className="mb-card-stat red">
                    <span>{anti.lostRevenue}</span>
                    <small>lost</small>
                  </div>
                </div>
                <p>{anti.desc}</p>
                <div className="mb-card-foot">
                  <span>Filter pattern</span>
                  <span>Open</span>
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}

function CallsPane({ data, open }: { data: MarketingBrainData; open: (modal: ModalState) => void }) {
  return (
    <div className="mb-table-shell">
      <div className="mb-table-head">
        <h3>All calls</h3>
        <span>Today + last 14 days - click a row for the packet</span>
      </div>
      <table className="mb-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Lead</th>
            <th>Avatar</th>
            <th>From</th>
            <th className="num">Score</th>
            <th>Status</th>
            <th className="num">Deal</th>
          </tr>
        </thead>
        <tbody>
          {data.callsHistory.map((call) => (
            <tr key={`${call.name}-${call.date}`} onClick={() => open({ kind: "call", item: call })}>
              <td className="mono muted">{call.time ? `${call.date} ${call.time}` : call.date}</td>
              <td className="strong">{call.name}</td>
              <td>{call.avatar}</td>
              <td className="mono muted">{call.source}</td>
              <td className={`num score ${scoreTier(call.score)}`}>{call.score}</td>
              <td><span className={`mb-stage ${call.status}`}>{call.status}</span></td>
              <td className="num">{call.deal ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhrasesPane({ data }: { data: MarketingBrainData }) {
  return (
    <div className="mb-phrases-grid">
      <PhrasePanel title="Closes" label="up lift" phrases={data.phrasesUp} />
      <PhrasePanel title="Flops" label="down lift" phrases={data.phrasesDown} negative />
    </div>
  );
}

function PhrasePanel({ title, label, phrases, negative }: { title: string; label: string; phrases: Array<{ phrase: string; lift: string }>; negative?: boolean }) {
  return (
    <section className="mb-language-panel">
      <h3>{title}<span className={negative ? "down" : "up"}>{label}</span></h3>
      <div className="mb-language-sub">
        {negative ? "Words showing up in low-quality ads and lost calls." : "Words showing up in closed calls and high-quality ads."}
      </div>
      {phrases.map((phrase) => (
        <div className="mb-phrase" key={phrase.phrase}>
          <span className={negative ? "neg" : ""}>{phrase.lift}</span>
          <p>{phrase.phrase}</p>
        </div>
      ))}
    </section>
  );
}

function AdsPane({ data }: { data: MarketingBrainData }) {
  return (
    <div className="mb-table-shell">
      <div className="mb-table-head">
        <h3>Ads, ranked by close rate</h3>
        <span>Primary text + OCR text from the image creative</span>
      </div>
      <table className="mb-table mb-ad-table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>Primary text</th>
            <th>Image text</th>
            <th className="num">Calls</th>
            <th className="num">Closed</th>
            <th className="num">Rate</th>
          </tr>
        </thead>
        <tbody>
          {data.ads.map((ad) => (
            <tr key={ad.id}>
              <td className="mb-ad-id">{ad.id}</td>
              <td className="copy">{ad.copy}</td>
              <td className="copy ocr">{ad.imageText}</td>
              <td className="num">{ad.calls}</td>
              <td className="num">{ad.closed}</td>
              <td className={`num ad-rate ${ad.rate >= 60 ? "hot" : ad.rate >= 40 ? "mid" : "cold"}`}>{ad.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BriefsPane({ data, open }: { data: MarketingBrainData; open: (modal: ModalState) => void }) {
  return (
    <div className="mb-card-grid">
      {data.briefs.map((brief) => (
        <button className={`mb-card ${brief.status === "approved" ? "green" : "gold"}`} key={brief.id} onClick={() => open({ kind: "brief", item: brief })}>
          <div className="mb-card-head">
            <div>
              <div className="mb-card-title">{brief.title}</div>
              <div className="mb-card-tag">{brief.calls} calls - {brief.ads} ads</div>
            </div>
            <span className={`mb-pill ${brief.status}`}>{brief.status}</span>
          </div>
          <p>{brief.summary}</p>
          <div className="mb-card-foot">
            <span>{brief.generated}</span>
            <span>Open</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function TrendsPane({ data }: { data: MarketingBrainData }) {
  return (
    <div className="mb-trends-grid">
      <LineChart title="Close rate - last 12 weeks" sub="Weekly close rate from sales tracker outcomes." values={data.trends.closeRate} color="#d4b27a" suffix="%" />
      <MultiLineChart title="Phrases shifting" sub="Lift per phrase over time." series={data.trends.phrases} />
      <StackBars title="Avatar mix - weekly calls" sub="Which avatars are showing up week over week." data={data.trends.avatarMix} />
      <MultiLineChart title="Anti-ICP signals" sub="Wrong-fit bookings by week." series={data.trends.antiICP} />
    </div>
  );
}

function LibraryPane({ data, open }: { data: MarketingBrainData; open: (modal: ModalState) => void }) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("people");
  const [peopleTab, setPeopleTab] = useState<PeopleTab>("buyers");

  return (
    <section>
      <PaneHead title="All data" sub="People, calls, language, ads, briefs, trends - open anything to look it up" />
      <div className="mb-lib-nav">
        {libraryTabs.map((tab) => (
          <button className={libraryTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setLibraryTab(tab.id)} type="button">
            {tab.label}
            {tab.id === "people" && <TabCount count={data.avatars.length + data.antiAvatars.length} />}
            {tab.id === "calls" && <TabCount count={data.callsHistory.length} />}
            {tab.id === "ads" && <TabCount count={data.ads.length} />}
            {tab.id === "briefs" && <TabCount count={data.briefs.length} />}
          </button>
        ))}
      </div>
      {libraryTab === "people" && <PeoplePane data={data} peopleTab={peopleTab} setPeopleTab={setPeopleTab} open={open} />}
      {libraryTab === "calls" && <CallsPane data={data} open={open} />}
      {libraryTab === "phrases" && <PhrasesPane data={data} />}
      {libraryTab === "ads" && <AdsPane data={data} />}
      {libraryTab === "briefs" && <BriefsPane data={data} open={open} />}
      {libraryTab === "trends" && <TrendsPane data={data} />}
    </section>
  );
}

function RulesPane({ data, open }: { data: MarketingBrainData; open: (modal: ModalState) => void }) {
  return (
    <section>
      <PaneHead
        title="Decision rules"
        sub="The paradigms the brain uses. Update or add to teach it how you think."
        action={<button className="mb-btn-primary" onClick={() => open({ kind: "newRule" })}>+ Add rule</button>}
      />
      <div className="mb-rules-feed">
        {data.rules.map((rule) => (
          <button className={`mb-rule ${rule.active ? "" : "inactive"}`} key={rule.id} onClick={() => open({ kind: "rule", item: rule })}>
            <div className="mb-rule-head">
              <span className={`mb-rule-tag ${rule.category}`}>{rule.category}</span>
              <span className="mb-toggle" aria-hidden="true"><span /></span>
            </div>
            <p>{rule.text}</p>
            <div className="mb-rule-foot">
              <span>{rule.basis}</span>
              <span>{rule.edited}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function NeuralPane({ data }: { data: MarketingBrainData }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const nodeW = 174;
  const nodeH = 60;
  const colX = [20, 270, 540, 810, 1080];
  const rowY = (row: number) => 48 + row * 82;
  const positioned = data.neural.nodes.map((node) => ({
    ...node,
    x: colX[node.col],
    y: rowY(node.row),
    cx: colX[node.col] + nodeW / 2,
    cy: rowY(node.row) + nodeH / 2,
  }));
  const nodeById = (id: string) => positioned.find((node) => node.id === id);
  const paths = data.neural.edges.map((edge) => {
    const from = nodeById(edge.from);
    const to = nodeById(edge.to);
    if (!from || !to) return "";
    const x1 = from.x + nodeW;
    const y1 = from.cy;
    const x2 = to.x;
    const y2 = to.cy;
    const dx = (x2 - x1) * 0.55;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  });
  const focused = focusedId ? nodeById(focusedId) : null;
  const inbound = focusedId ? data.neural.edges.filter((edge) => edge.to === focusedId) : [];
  const outbound = focusedId ? data.neural.edges.filter((edge) => edge.from === focusedId) : [];
  const connected = new Set([focusedId ?? "", ...inbound.map((edge) => edge.from), ...outbound.map((edge) => edge.to)]);
  const isEdgeOn = (edge: NeuralEdge) => focusedId ? edge.from === focusedId || edge.to === focusedId : false;

  return (
    <section>
      <PaneHead title="Neural network" sub="How the brain is wired - inputs flow through processing into the outputs you see" />
      <div className="mb-neural-wrap">
        <div className="mb-nn-live">live</div>
        <svg className={`mb-nn-svg ${focusedId ? "focused" : ""}`} viewBox="0 0 1274 520" preserveAspectRatio="xMidYMid meet">
          {["Inputs", "Mined data", "Rules", "Synthesis", "Outputs"].map((label, index) => (
            <text className="mb-nn-label" x={colX[index] + nodeW / 2} y="22" textAnchor="middle" key={label}>{label}</text>
          ))}
          {data.neural.edges.map((edge, index) => (
            <path
              className={`mb-nn-edge ${edge.emphasis ? "emphasis" : ""} ${isEdgeOn(edge) ? "on" : ""}`}
              d={paths[index]}
              id={`mb-edge-${index}`}
              key={`${edge.from}-${edge.to}`}
            />
          ))}
          {data.neural.edges.map((edge, index) => (
            <circle className={`mb-nn-particle ${edge.emphasis ? "emphasis" : ""} ${isEdgeOn(edge) ? "on" : ""}`} r={edge.emphasis ? 3 : 2.4} key={`particle-${edge.from}-${edge.to}`}>
              <animateMotion dur={`${3.8 + (index % 6) * 0.45}s`} begin={`${(index % 7) * 0.2}s`} repeatCount="indefinite">
                <mpath href={`#mb-edge-${index}`} />
              </animateMotion>
            </circle>
          ))}
          {positioned.map((node) => {
            const isOn = focusedId ? connected.has(node.id) : false;
            return (
              <g
                className={`mb-nn-node ${node.type} ${isOn ? "on" : ""}`}
                data-id={node.id}
                key={node.id}
                onClick={(event) => {
                  event.stopPropagation();
                  setFocusedId(node.id);
                }}
                role="button"
                tabIndex={0}
                transform={`translate(${node.x}, ${node.y})`}
              >
                <rect width={nodeW} height={nodeH} rx="9" />
                <text x="14" y="22" className="node-title">{node.label}</text>
                <text x="14" y="40" className="node-sub">{node.sub}</text>
                <circle cx={nodeW - 14} cy="22" r="3" />
                <text x={nodeW - 28} y="44" className="node-glyph" textAnchor="end">{node.glyph}</text>
              </g>
            );
          })}
        </svg>
        <div className="mb-nn-legend">
          <span><i className="input" />Inputs</span>
          <span><i className="data" />Mined data</span>
          <span><i className="rules" />Decision rules</span>
          <span><i className="synth" />Synthesis</span>
          <span><i className="output" />Outputs</span>
        </div>
        {focused && (
          <aside className="mb-nn-detail">
            <button className="mb-nn-close" onClick={() => setFocusedId(null)} type="button">x</button>
            <div className={`mb-d-type ${focused.type}`}>{focused.type}</div>
            <h2>{focused.label}</h2>
            <div className="mb-d-sub">{focused.sub}</div>
            <p>{focused.desc}</p>
            <NodeLinks title="Receives from" edges={inbound} direction="from" nodeById={nodeById} setFocusedId={setFocusedId} />
            <NodeLinks title="Feeds" edges={outbound} direction="to" nodeById={nodeById} setFocusedId={setFocusedId} />
          </aside>
        )}
      </div>
    </section>
  );
}

function NodeLinks({ title, edges, direction, nodeById, setFocusedId }: {
  title: string;
  edges: NeuralEdge[];
  direction: "from" | "to";
  nodeById: (id: string) => (NeuralNode & { x: number; y: number; cx: number; cy: number }) | undefined;
  setFocusedId: (id: string) => void;
}) {
  return (
    <div className="mb-d-block">
      <div className="mb-d-label">{title} <span>{edges.length}</span></div>
      {edges.length === 0 ? <div className="mb-d-empty">Nothing.</div> : (
        <div className="mb-d-list">
          {edges.map((edge) => {
            const node = nodeById(edge[direction]);
            if (!node) return null;
            return <button className={node.type} key={`${edge.from}-${edge.to}`} onClick={() => setFocusedId(node.id)}><i />{node.label}</button>;
          })}
        </div>
      )}
    </div>
  );
}

function Modal({ modal, data, close }: { modal: ModalState; data: MarketingBrainData; close: () => void }) {
  if (!modal) return null;

  return (
    <div className="mb-modal-bg open" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="mb-modal">
        <div className="mb-modal-head">
          <div>
            <h2>{modalTitle(modal)}</h2>
            <div className={`mb-modal-tag ${modalTag(modal)}`}>{modalTag(modal)}</div>
          </div>
          <button className="mb-modal-close" onClick={close} type="button">x</button>
        </div>
        <div className="mb-modal-body">{modalBody(modal, data)}</div>
        <div className="mb-modal-foot">
          <span />
          <button className="mb-btn-ghost" onClick={close} type="button">Close</button>
          <button className="mb-btn-primary" type="button">{modalAction(modal)}</button>
        </div>
      </div>
    </div>
  );
}

function modalTitle(modal: Exclude<ModalState, null>) {
  switch (modal.kind) {
    case "verdict":
      return modal.item.claim;
    case "avatar":
    case "anti":
    case "call":
      return modal.item.name;
    case "brief":
      return modal.item.title;
    case "rule":
      return modal.item.text;
    case "newRule":
      return "Add decision rule";
    case "cost":
      return "Cost controls";
  }
}

function modalTag(modal: Exclude<ModalState, null>) {
  if (modal.kind === "verdict") return modal.item.type;
  if (modal.kind === "avatar") return "buyer avatar";
  if (modal.kind === "anti") return "filter out";
  if (modal.kind === "brief") return modal.item.status;
  if (modal.kind === "call") return "pre-call packet";
  if (modal.kind === "rule") return modal.item.category;
  if (modal.kind === "cost") return "spend guardrails";
  return "new rule";
}

function modalAction(modal: Exclude<ModalState, null>) {
  if (modal.kind === "verdict") return modal.item.action;
  if (modal.kind === "brief") return "Push to Campaign Launcher";
  if (modal.kind === "call") return "Open transcript";
  if (modal.kind === "newRule") return "Save rule";
  if (modal.kind === "cost") return "Approve backfill";
  return "Use in Brain";
}

function modalBody(modal: Exclude<ModalState, null>, data: MarketingBrainData) {
  if (modal.kind === "verdict") return <VerdictReceipt verdict={modal.item} />;
  if (modal.kind === "avatar") return <AvatarDetail avatar={modal.item} />;
  if (modal.kind === "anti") return <AntiDetail anti={modal.item} />;
  if (modal.kind === "brief") return <BriefDetail brief={modal.item} />;
  if (modal.kind === "call") return <CallDetail item={modal.item} data={data} />;
  if (modal.kind === "rule") return <RuleDetail rule={modal.item} />;
  if (modal.kind === "cost") return <CostDetail data={data} />;
  return <NewRuleForm />;
}

function VerdictReceipt({ verdict }: { verdict: Verdict }) {
  return (
    <>
      {verdict.receipts.map((block, index) => (
        <Receipt block={block} key={`${block.type}-${index}`} />
      ))}
    </>
  );
}

function Receipt({ block }: { block: ReceiptBlock }) {
  if (block.type === "text") {
    return <Block label={block.title}><p className="mb-body-text">{block.body}</p></Block>;
  }
  if (block.type === "stats") {
    return <Block label={block.title}><div className="mb-stat-list">{block.items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></Block>;
  }
  if (block.type === "compare") {
    return <Block label={block.title}><table className="mb-mini-table"><thead><tr><th /> <th>{block.headers[0]}</th><th>{block.headers[1]}</th></tr></thead><tbody>{block.items.map((item) => <tr key={item.label}><td>{item.label}</td><td className="bad">{item.a}</td><td className="good">{item.b}</td></tr>)}</tbody></table></Block>;
  }
  if (block.type === "quotes") {
    return <Block label={block.title}><div className="mb-quotes">{block.items.map((item) => <div className="mb-quote" key={item.text}><span>{item.source}</span><p>{item.text}</p></div>)}</div></Block>;
  }
  return <Block label={block.title}><div className="mb-phrase-list">{block.items.map((item) => <div key={item.phrase}><span className={item.negative ? "neg" : ""}>{item.lift}</span><p>{item.phrase}</p></div>)}</div></Block>;
}

function AvatarDetail({ avatar }: { avatar: Avatar }) {
  return (
    <>
      <div className="mb-modal-stats">
        <Stat value={avatar.revenue} label="Revenue" gold />
        <Stat value={`${avatar.closeRate}%`} label="Close" />
        <Stat value={avatar.avgDeal} label="Avg deal" />
        <Stat value={avatar.ltv} label="LTV" />
      </div>
      <Block label="Who they are"><BulletList items={avatar.who} /></Block>
      <Block label="Hooks that close"><HookList hooks={avatar.hooks} /></Block>
      <Block label="Representative quote"><div className="mb-big-quote">{avatar.quote}</div></Block>
      <Block label="Targeting"><pre className="mb-targeting">{avatar.targeting}</pre></Block>
    </>
  );
}

function AntiDetail({ anti }: { anti: AntiAvatar }) {
  return (
    <>
      <div className="mb-modal-stats">
        <Stat value={anti.lostRevenue} label="Lost" red />
        <Stat value={`${anti.calls}`} label="Calls" />
      </div>
      <Block label="Why they fail"><BulletList items={anti.why} /></Block>
      <Block label="Examples"><div className="mb-quotes">{anti.examples.map((example) => <div className="mb-quote" key={example}><p>{example}</p></div>)}</div></Block>
      <Block label="Action"><div className="mb-action-box">{anti.action}</div></Block>
    </>
  );
}

function BriefDetail({ brief }: { brief: CampaignBrief }) {
  return (
    <>
      <Block label="Summary"><p className="mb-body-text">{brief.summary}</p></Block>
      <Block label="Audience"><pre className="mb-targeting">{brief.audience}</pre></Block>
      <Block label="Hooks"><HookList hooks={brief.hooks} /></Block>
      <Block label="Avoid"><BulletList items={brief.avoid} danger /></Block>
      <Block label="Creative direction"><p className="mb-body-text">{brief.creative}</p></Block>
      <Block label="Budget"><p className="mb-body-text">{brief.budget}</p></Block>
    </>
  );
}

function CallDetail({ item, data }: { item: CallHistory | UpcomingCall; data: MarketingBrainData }) {
  const brief = data.callBriefs[item.name];
  if (!brief && "detail" in item && item.detail) {
    return (
      <>
        <Block label="Outcome"><p className="mb-body-text">{item.detail.outcome}</p></Block>
        <Block label="Quote"><div className="mb-big-quote">{item.detail.quote}</div></Block>
        <Block label="DM thread"><DmList messages={item.detail.dm} /></Block>
      </>
    );
  }
  if (!brief) return <p className="mb-body-text">No packet available yet.</p>;
  return (
    <>
      <div className={`mb-brief-score ${scoreTier("score" in item ? item.score : 0)}`}>
        <strong>{"score" in item ? item.score : ""}</strong>
        <span>{brief.avatarMatch}</span>
      </div>
      <Block label="Takeaway"><p className="mb-body-text">{brief.takeaway}</p></Block>
      <Block label="Score breakdown"><Breakdown rows={brief.breakdown} /></Block>
      <Block label="DM thread"><DmList messages={brief.dm} meta={brief.dmMeta} /></Block>
      <Block label="Suggested opener"><div className="mb-open-line">{brief.opener}</div></Block>
      <Block label="Ask"><BulletList items={brief.ask} /></Block>
      <Block label="Do not say"><BulletList items={brief.dont} danger /></Block>
    </>
  );
}

function RuleDetail({ rule }: { rule: DecisionRule }) {
  return (
    <>
      <Block label="Rule"><p className="mb-body-text">{rule.text}</p></Block>
      <Block label="Basis"><p className="mb-body-text">{rule.basis}</p></Block>
      <Block label="Status"><p className="mb-body-text">{rule.active ? "Active" : "Inactive"} - edited {rule.edited}</p></Block>
    </>
  );
}

function CostDetail({ data }: { data: MarketingBrainData }) {
  return (
    <>
      <div className="mb-modal-stats">
        <Stat value={data.cost.spend} label="This month" gold />
        <Stat value={data.cost.cap} label="Cap" />
        <Stat value={data.cost.perCall} label="Avg/call" />
        <Stat value={data.cost.backfill} label="Backfill" />
      </div>
      <Block label="Rule"><p className="mb-body-text">Read big files once. Save small facts. Reuse forever.</p></Block>
      <Block label="OCR note"><p className="mb-body-text">Ad image text should be extracted once when the creative enters the catalog, then stored beside the ad copy for phrase mining.</p></Block>
    </>
  );
}

function NewRuleForm() {
  return (
    <>
      <Block label="Rule text"><textarea className="mb-rule-textarea" placeholder="Example: If an ad is winning on cash quality, do not turn it off. Test sibling variations first." /></Block>
      <Block label="Category"><div className="mb-chip-row"><span>Scoring</span><span>Copy</span><span>Filtering</span><span>Strategy</span></div></Block>
    </>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="mb-modal-block"><div className="mb-modal-label">{label}</div>{children}</section>;
}

function Stat({ value, label, gold, red }: { value: string; label: string; gold?: boolean; red?: boolean }) {
  return <div className="mb-m-stat"><strong className={gold ? "gold" : red ? "red" : ""}>{value}</strong><span>{label}</span></div>;
}

function BulletList({ items, danger }: { items: string[]; danger?: boolean }) {
  return <ul className={danger ? "mb-bullets danger" : "mb-bullets"}>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function HookList({ hooks }: { hooks: Array<{ text: string; lift: string }> }) {
  return <div className="mb-hooks">{hooks.map((hook) => <div className="mb-hook" key={hook.text}><span>{hook.text}</span><strong>{hook.lift}</strong></div>)}</div>;
}

function DmList({ messages, meta }: { messages: Array<{ time: string; text: string }>; meta?: string }) {
  return (
    <div className="mb-dms">
      {messages.map((message) => (
        <div className="mb-dm" key={`${message.time}-${message.text}`}>
          <span>{message.time}</span>
          <p>{message.text}</p>
        </div>
      ))}
      {meta && <div className="mb-dm-meta">{meta}</div>}
    </div>
  );
}

function Breakdown({ rows }: { rows: Array<{ label: string; value: number; positive: boolean }> }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="mb-breakdown">
      {rows.map((row) => (
        <div className="mb-bd-row" key={row.label}>
          <span>{row.label}</span>
          <div><i className={row.positive ? "pos" : "neg"} style={{ width: `${Math.min(Math.abs(row.value) * 2, 100)}%` }} /></div>
          <strong className={row.positive ? "pos" : "neg"}>{row.value > 0 ? `+${row.value}` : row.value}</strong>
        </div>
      ))}
      <div className="mb-bd-total"><span>Total</span><strong>{total}</strong></div>
    </div>
  );
}

function LineChart({ title, sub, values, color, suffix = "" }: { title: string; sub: string; values: number[]; color: string; suffix?: string }) {
  const width = 420;
  const height = 170;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / Math.max(max - min, 1)) * (height - 20) - 10;
    return `${x},${y}`;
  }).join(" ");
  return (
    <section className="mb-chart-card">
      <h3>{title}</h3>
      <p>{sub}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mb-chart-svg">
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
        {values.map((value, index) => {
          const [x, y] = points.split(" ")[index].split(",").map(Number);
          return <circle cx={x} cy={y} r="3" fill={color} key={`${value}-${index}`} />;
        })}
      </svg>
      <div className="mb-chart-caption">{values[values.length - 1]}{suffix} latest</div>
    </section>
  );
}

function MultiLineChart({ title, sub, series }: { title: string; sub: string; series: Array<{ name: string; color: string; data: number[] }> }) {
  const all = series.flatMap((item) => item.data);
  const max = Math.max(...all, 1);
  const min = Math.min(...all, -1);
  const width = 420;
  const height = 170;
  const pointList = (values: number[]) => values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / Math.max(max - min, 1)) * (height - 20) - 10;
    return `${x},${y}`;
  }).join(" ");
  return (
    <section className="mb-chart-card">
      <h3>{title}</h3>
      <p>{sub}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mb-chart-svg">
        {series.map((item) => <polyline fill="none" stroke={item.color} strokeWidth="2" points={pointList(item.data)} key={item.name} />)}
      </svg>
      <div className="mb-chart-legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
    </section>
  );
}

function StackBars({ title, sub, data }: { title: string; sub: string; data: MarketingBrainData["trends"]["avatarMix"] }) {
  return (
    <section className="mb-chart-card">
      <h3>{title}</h3>
      <p>{sub}</p>
      <div className="mb-stack-bars">
        {data.weeks.map((week, index) => {
          const total = week.reduce((sum, value) => sum + value, 0);
          return (
            <div className="mb-stack" key={index}>
              {week.map((value, innerIndex) => <span key={`${index}-${data.stages[innerIndex]}`} style={{ height: `${(value / total) * 100}%`, background: data.colors[innerIndex] }} />)}
            </div>
          );
        })}
      </div>
      <div className="mb-chart-legend">{data.stages.map((stage, index) => <span key={stage}><i style={{ background: data.colors[index] }} />{stage}</span>)}</div>
    </section>
  );
}

export default function MarketingBrainDashboard({ data }: { data: MarketingBrainData }) {
  const [activeTab, setActiveTab] = useState<BrainTab>("verdicts");
  const [modal, setModal] = useState<ModalState>(null);
  const tabCounts: Partial<Record<BrainTab, number>> = {
    verdicts: data.verdicts.length,
    precall: data.upcoming.length,
    rules: data.rules.length,
  };

  return (
    <div className="marketing-brain mb-v11">
      <nav className="mb-top">
        <div className="mb-nav-inner">
          <div className="mb-brand"><div className="mb-brand-mark">M</div>Marketing Brain</div>
          <div className="mb-tabs" role="tablist">
            {brainTabs.map((tab) => (
              <button className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">
                {tab.label}
                <TabCount count={tabCounts[tab.id]} />
              </button>
            ))}
          </div>
          <button className="mb-sync" onClick={() => setModal({ kind: "cost" })} type="button">
            <span />
            {data.syncLabel}
            <em>cost {data.cost.spend}/{data.cost.cap}</em>
          </button>
        </div>
      </nav>
      <main className="mb-page">
        {activeTab === "verdicts" && <VerdictsPane data={data} open={setModal} />}
        {activeTab === "precall" && <PrecallPane data={data} open={setModal} />}
        {activeTab === "library" && <LibraryPane data={data} open={setModal} />}
        {activeTab === "rules" && <RulesPane data={data} open={setModal} />}
        {activeTab === "neural" && <NeuralPane data={data} />}
      </main>
      <Modal modal={modal} data={data} close={() => setModal(null)} />
    </div>
  );
}
