export default function CampaignLauncherPage() {
  return (
    <main className="campaign-launcher-page" aria-label="Campaign Launcher">
      <style>{`
        .campaign-launcher-page{
          min-height:100vh;
          background:#050505;
          color:#e8e8e8;
          padding:28px;
          font-family:var(--font-geist-sans),Inter,system-ui,sans-serif;
        }
        .launcher-wrap{max-width:1180px;margin:0 auto}
        .launcher-crumb{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:10.5px;
          letter-spacing:.13em;
          text-transform:uppercase;
          color:#4a4a4a;
          display:flex;
          align-items:center;
          gap:8px;
          margin-bottom:10px;
        }
        .launcher-crumb a{color:#6b6b6b;text-decoration:none}
        .launcher-crumb a:hover{color:#a8a8a8}
        .launcher-crumb span:last-child{color:#d4b27a}
        .launcher-head{
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:18px;
          margin-bottom:24px;
        }
        .launcher-title{
          margin:0 0 6px;
          font-size:22px;
          line-height:1.12;
          font-weight:600;
          letter-spacing:-.02em;
          color:#e8e8e8;
          display:flex;
          align-items:center;
          gap:11px;
        }
        .launcher-badge{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:9.5px;
          letter-spacing:.13em;
          text-transform:uppercase;
          color:#d4b27a;
          background:rgba(212,178,122,.07);
          border:1px solid rgba(212,178,122,.25);
          padding:3px 8px;
          border-radius:999px;
          font-weight:500;
        }
        .launcher-sub{font-size:12px;color:#6b6b6b}
        .launcher-back{
          display:inline-flex;
          align-items:center;
          gap:7px;
          min-height:32px;
          padding:0 12px;
          border:1px solid #262626;
          border-radius:6px;
          background:#0f0f0f;
          color:#a8a8a8;
          text-decoration:none;
          font-size:12px;
        }
        .launcher-back:hover{background:#141414;color:#e8e8e8}
        .run-banner{
          display:grid;
          grid-template-columns:1.4fr 1fr 1fr 1fr;
          gap:0;
          border:1px solid #262626;
          border-radius:10px;
          background:linear-gradient(180deg,#0d0d0d,#0a0a0a);
          overflow:hidden;
          margin-bottom:28px;
          position:relative;
        }
        .run-banner:before{
          content:"";
          position:absolute;
          inset:0;
          background:radial-gradient(ellipse 70% 80% at 0% 0%,rgba(212,178,122,.06),transparent 60%);
          pointer-events:none;
        }
        .rb-cell{padding:14px 18px;border-right:1px solid #1f1f1f;position:relative}
        .rb-cell:last-child{border-right:none}
        .rb-lbl{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:9.5px;
          letter-spacing:.13em;
          text-transform:uppercase;
          color:#4a4a4a;
        }
        .rb-val{
          margin-top:4px;
          display:flex;
          align-items:center;
          gap:8px;
          color:#e8e8e8;
          font-size:15px;
          font-weight:500;
          letter-spacing:-.005em;
        }
        .live-dot{
          width:6px;
          height:6px;
          border-radius:999px;
          background:#d4b27a;
          box-shadow:0 0 8px #d4b27a;
        }
        .launcher-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;align-items:start}
        .launcher-panel{
          border:1px solid #1f1f1f;
          border-radius:8px;
          background:#111;
          overflow:hidden;
        }
        .panel-head{
          padding:16px 18px;
          border-bottom:1px solid #1f1f1f;
          background:#0c0c0c;
        }
        .panel-kicker{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:10px;
          letter-spacing:.13em;
          text-transform:uppercase;
          color:#d4b27a;
          margin-bottom:6px;
        }
        .panel-title{font-size:15px;font-weight:600;color:#e8e8e8}
        .panel-copy{font-size:12px;line-height:1.6;color:#6b6b6b;margin-top:5px;max-width:620px}
        .check-list{display:flex;flex-direction:column}
        .check-row{
          display:grid;
          grid-template-columns:24px 1fr auto;
          gap:12px;
          align-items:center;
          padding:13px 18px;
          border-bottom:1px solid #1f1f1f;
        }
        .check-row:last-child{border-bottom:none}
        .check-icon{
          width:18px;
          height:18px;
          border-radius:999px;
          display:grid;
          place-items:center;
          font-size:11px;
          font-weight:700;
          font-family:var(--font-geist-mono),ui-monospace,monospace;
        }
        .check-icon.good{background:#0c1a12;border:1px solid #1a2e22;color:#7dd3a8}
        .check-icon.warn{background:#1a1608;border:1px solid #2a2417;color:#d4b27a}
        .check-name{font-size:13px;color:#e8e8e8}
        .check-detail{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:10.5px;
          color:#6b6b6b;
          margin-top:3px;
        }
        .check-state{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:10px;
          letter-spacing:.09em;
          text-transform:uppercase;
          color:#8a7348;
        }
        .plan-preview{padding:16px 18px}
        .plan-line{
          display:grid;
          grid-template-columns:42px 1fr auto;
          align-items:center;
          gap:12px;
          padding:10px 0;
          border-bottom:1px solid #1f1f1f;
        }
        .plan-line:last-child{border-bottom:none}
        .thumb{
          width:36px;
          height:36px;
          border-radius:4px;
          border:1px solid #262626;
          background:radial-gradient(circle at 50% 40%,#2a2417,#0c0c0c 70%);
        }
        .pl-key{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:11.5px;
          letter-spacing:.06em;
          color:#e8e8e8;
        }
        .pl-msg{font-size:11px;color:#6b6b6b;margin-top:3px}
        .pl-action{
          font-family:var(--font-geist-mono),ui-monospace,monospace;
          font-size:10px;
          letter-spacing:.08em;
          text-transform:uppercase;
          color:#7dd3a8;
        }
        @media(max-width:900px){
          .campaign-launcher-page{padding:20px}
          .launcher-head{flex-direction:column}
          .run-banner,.launcher-grid{grid-template-columns:1fr}
          .rb-cell{border-right:none;border-bottom:1px solid #1f1f1f}
          .rb-cell:last-child{border-bottom:none}
        }
      `}</style>

      <div className="launcher-wrap">
        <div className="launcher-crumb">
          <a href="/ads">Ads</a>
          <span>/</span>
          <span>Campaign Launcher</span>
        </div>

        <div className="launcher-head">
          <div>
            <h1 className="launcher-title">
              Campaign Launcher
              <span className="launcher-badge">Design Shell</span>
            </h1>
            <div className="launcher-sub">
              Upload media, verify Meta setup, and launch keyword ads safely.
            </div>
          </div>
          <a className="launcher-back" href="/ads">Back to Ads</a>
        </div>

        <section className="run-banner" aria-label="Launch status preview">
          <div className="rb-cell">
            <div className="rb-lbl">Status</div>
            <div className="rb-val"><span className="live-dot" /> Ready to build</div>
          </div>
          <div className="rb-cell">
            <div className="rb-lbl">Mode</div>
            <div className="rb-val">VA guided</div>
          </div>
          <div className="rb-cell">
            <div className="rb-lbl">Safety</div>
            <div className="rb-val">Manual publish</div>
          </div>
          <div className="rb-cell">
            <div className="rb-lbl">Source</div>
            <div className="rb-val">Uploaded design</div>
          </div>
        </section>

        <div className="launcher-grid">
          <section className="launcher-panel">
            <div className="panel-head">
              <div className="panel-kicker">Step 1 of 5</div>
              <div className="panel-title">Real workflow will live here</div>
              <div className="panel-copy">
                This placeholder keeps the route live while we convert your launcher design into the actual campaign launch process.
              </div>
            </div>
            <div className="check-list">
              <div className="check-row">
                <span className="check-icon good">✓</span>
                <div>
                  <div className="check-name">Use your uploaded launcher design</div>
                  <div className="check-detail">Layout, dark theme, panels, checks, and progress states stay intact.</div>
                </div>
                <span className="check-state">Locked</span>
              </div>
              <div className="check-row">
                <span className="check-icon warn">!</span>
                <div>
                  <div className="check-name">Replace demo content with the real launch SOP</div>
                  <div className="check-detail">Meta setup, risky toggles, seed ad, keyword/media matching.</div>
                </div>
                <span className="check-state">Next</span>
              </div>
              <div className="check-row">
                <span className="check-icon warn">!</span>
                <div>
                  <div className="check-name">Keep final publish manual in v1</div>
                  <div className="check-detail">Ad account safety wins over speed.</div>
                </div>
                <span className="check-state">Safety</span>
              </div>
            </div>
          </section>

          <section className="launcher-panel">
            <div className="panel-head">
              <div className="panel-kicker">Plan Preview</div>
              <div className="panel-title">Keyword rows</div>
              <div className="panel-copy">Example rows only. The real version will use uploaded files and approved keywords.</div>
            </div>
            <div className="plan-preview">
              {["EDGE", "RISE", "FOCUS", "RESULTS"].map((keyword, index) => (
                <div className="plan-line" key={keyword}>
                  <div className="thumb" />
                  <div>
                    <div className="pl-key">{keyword}</div>
                    <div className="pl-msg">Reply {keyword} to start Summer Shred</div>
                  </div>
                  <div className="pl-action">{index === 0 ? "Keep" : "Create"}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
