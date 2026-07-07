/* AI Capex Monitor ダッシュボード */
let SNAP = null;
let sectorFilter = null;
let sortKey = "market_cap";
let sortDir = -1;

const $ = (s) => document.querySelector(s);

/* ---------- フォーマッタ ---------- */
const pct = (v, digits = 1) =>
  v == null ? '<span class="na">—</span>'
    : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%</span>`;

const pctPlain = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

function fmtCap(v, ccy) {
  if (v == null) return '<span class="na">—</span>';
  if (ccy === "JPY") return `¥${(v / 1e12).toFixed(2)}兆`;
  if (ccy === "KRW") return `₩${(v / 1e12).toFixed(0)}兆`;
  return `$${(v / 1e9).toFixed(0)}B`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}分前`;
  if (h < 24) return `${Math.round(h)}時間前`;
  return `${Math.round(h / 24)}日前`;
}

function heatColor(h) {
  if (h >= 70) return "#e05a5a";
  if (h >= 50) return "#f2a93b";
  if (h >= 30) return "#4f8ef7";
  return "#5b6577";
}

function hexA(hex, a) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function brighten(hex, amt) {
  const c = hex.replace("#", "");
  let r = parseInt(c.substr(0, 2), 16);
  let g = parseInt(c.substr(2, 2), 16);
  let b = parseInt(c.substr(4, 2), 16);
  r = Math.round(r + (255 - r) * amt);
  g = Math.round(g + (255 - g) * amt);
  b = Math.round(b + (255 - b) * amt);
  return `rgb(${r},${g},${b})`;
}

/* ---------- サマリー ---------- */
function renderSummary() {
  const hc = SNAP.hyperscaler_capex;
  const top = SNAP.sectors[0];
  const cutoff = Date.now() - 864e5;
  const newsToday = SNAP.news.filter((n) => n.published && new Date(n.published) > cutoff).length;
  const latestQ = hc.headline_q || "—";
  $("#summary").innerHTML = `
    <div class="summary-item">
      <div class="label">ハイパースケーラー CAPEX 合計（${latestQ}）</div>
      <div class="value">${hc.total_latest ? "$" + (hc.total_latest / 1e9).toFixed(0) + "B" : "—"}</div>
      <div class="delta">${pct(hc.total_yoy)} 前年同期比</div>
    </div>
    <div class="summary-item">
      <div class="label">最もホットなセクター</div>
      <div class="value" style="font-size:17px">${top ? top.ja : "—"}</div>
      <div class="delta">ヒートスコア ${top ? top.heat : "—"} / 100</div>
    </div>
    <div class="summary-item">
      <div class="label">直近24時間の関連ニュース</div>
      <div class="value">${newsToday}件</div>
      <div class="delta">全${SNAP.news.length}件を収集済み</div>
    </div>
    <div class="summary-item">
      <div class="label">監視銘柄</div>
      <div class="value">${SNAP.companies.length}社</div>
      <div class="delta">8セクター / 主力+2軍</div>
    </div>`;
}

/* ---------- セクターヒートマップ ---------- */
function renderSectors() {
  $("#sector-grid").innerHTML = SNAP.sectors
    .map((s) => {
      const active = sectorFilter === s.id ? "active" : "";
      return `
      <div class="sector-card ${active}" data-sector="${s.id}" style="border-left-color:${s.color}">
        <div class="name">${s.ja}</div>
        <div class="heat-row">
          <span class="heat-val" style="color:${heatColor(s.heat)}">${s.heat}</span>
          <span class="heat-label">ヒートスコア</span>
        </div>
        <div class="heat-bar"><div style="width:${s.heat}%;background:${heatColor(s.heat)}"></div></div>
        <div class="metrics">
          <span>CAPEX YoY <b>${pctPlain(s.capex_yoy)}</b></span>
          <span>株価1M <b>${pctPlain(s.momentum_1m)}</b></span>
          <span>ニュース7日 <b>${s.news_7d}</b></span>
        </div>
      </div>`;
    })
    .join("");
  document.querySelectorAll(".sector-card").forEach((el) => {
    el.onclick = () => {
      sectorFilter = sectorFilter === el.dataset.sector ? null : el.dataset.sector;
      renderSectors();
      renderTable();
      renderNews();
    };
  });
}

/* ---------- チャート ---------- */
let hyperChart, sectorCapexChart, taiwanChart;
const chartDefaults = () => {
  Chart.defaults.color = "#8a93a6";
  Chart.defaults.borderColor = "#2a3140";
  Chart.defaults.font.family = '"Hiragino Sans","Noto Sans JP",sans-serif';
};

function renderHyperChart() {
  const hc = SNAP.hyperscaler_capex;
  const colors = ["#4f8ef7", "#3fbf7f", "#f2a93b", "#e05a5a", "#b06ef7"];
  if (hyperChart) hyperChart.destroy();
  hyperChart = new Chart($("#hyper-chart"), {
    type: "bar",
    data: {
      labels: hc.quarters,
      datasets: hc.series.map((s, i) => ({
        label: s.ja,
        data: s.values.map((v) => (v == null ? null : v / 1e9)),
        backgroundColor: colors[i % colors.length],
        stack: "capex",
      })),
    },
    options: {
      responsive: true,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: (v) => "$" + v + "B" } },
      },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: $${c.parsed.y == null ? "—" : c.parsed.y.toFixed(1)}B`,
          },
        },
      },
    },
  });
}

function renderSectorCapexChart() {
  const secs = [...SNAP.sectors].sort((a, b) => (b.capex_yoy ?? -9) - (a.capex_yoy ?? -9));
  if (sectorCapexChart) sectorCapexChart.destroy();
  sectorCapexChart = new Chart($("#sector-capex-chart"), {
    type: "bar",
    data: {
      labels: secs.map((s) => s.ja),
      datasets: [{
        data: secs.map((s) => (s.capex_yoy == null ? null : s.capex_yoy * 100)),
        backgroundColor: secs.map((s) => (s.capex_yoy >= 0 ? "#3fbf7f" : "#e05a5a")),
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      scales: { x: { ticks: { callback: (v) => v + "%" } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => (c.parsed.x == null ? "—" : c.parsed.x.toFixed(1) + "%") } },
      },
    },
  });
}

function renderTaiwanChart() {
  const tw = SNAP.taiwan_revenue || [];
  const note = $("#taiwan-note");
  if (!tw.length || tw.every((s) => s.months.length < 2)) {
    note.textContent = "月次データは日々の実行ごとに1ヶ月分ずつ蓄積されます。数日〜数週間運用すると推移が見えてきます。";
  } else {
    note.textContent = "";
  }
  const months = [...new Set(tw.flatMap((s) => s.months))].sort();
  const colors = { TSM: "#e05a5a", UMC: "#4f8ef7" };
  if (taiwanChart) taiwanChart.destroy();
  taiwanChart = new Chart($("#taiwan-chart"), {
    type: "line",
    data: {
      labels: months,
      datasets: tw.map((s) => ({
        label: s.ticker,
        data: months.map((m) => {
          const i = s.months.indexOf(m);
          return i === -1 ? null : s.yoy[i] * 100;
        }),
        borderColor: colors[s.ticker] || "#8a93a6",
        backgroundColor: colors[s.ticker] || "#8a93a6",
        spanGaps: true,
        tension: 0.25,
      })),
    },
    options: {
      responsive: true,
      scales: { y: { ticks: { callback: (v) => v + "%" } } },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? "—" : c.parsed.y.toFixed(1) + "%"}` } },
      },
    },
  });
}

/* ---------- 企業テーブル ---------- */
function buzzScore(c) {
  return (c.reddit_mentions_7d || 0) + (c.stocktwits?.tagged_count || 0);
}

function sortVal(c) {
  switch (sortKey) {
    case "name": return c.ja;
    case "sector": return c.sector;
    case "market_cap": {
      const fx = { JPY: 1 / 150, KRW: 1 / 1400 }[c.currency] ?? 1;
      return (c.market_cap ?? -1) * fx;
    }
    case "r1m": return c.returns?.["1m"] ?? -99;
    case "r3m": return c.returns?.["3m"] ?? -99;
    case "buzz": return buzzScore(c);
    default: return c[sortKey] ?? -99;
  }
}

function sourceBadge(src) {
  if (src === "SEC EDGAR") return '<span class="src-badge src-edgar" title="SEC EDGAR: 米国企業の一次開示データ">SEC</span>';
  if (src === "Yahoo Finance（年次）") return '<span class="src-badge src-annual" title="年次データにフォールバック（四半期開示が無い企業）">年次</span>';
  return '<span class="src-badge src-yahoo" title="Yahoo Finance 四半期データ">Yahoo</span>';
}

function buzzCell(c) {
  const reddit = c.reddit_mentions_7d;
  const st = c.stocktwits;
  const parts = [];
  if (reddit) parts.push(`Reddit ${reddit}`);
  if (st) {
    const cls = st.bullish_pct >= 0.5 ? "up" : "down";
    parts.push(`ST <span class="${cls}">${Math.round(st.bullish_pct * 100)}%強気</span>(${st.tagged_count})`);
  }
  return parts.length ? parts.join(" / ") : '<span class="na">—</span>';
}

function renderTable() {
  const secMap = Object.fromEntries(SNAP.sectors.map((s) => [s.id, s]));
  let rows = SNAP.companies.filter((c) => !sectorFilter || c.sector === sectorFilter);
  rows = [...rows].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * sortDir;
  });
  $("#company-table tbody").innerHTML = rows
    .map((c) => {
      const s = secMap[c.sector];
      if (c.error) {
        return `<tr><td>${c.ja}<span class="tk">${c.ticker}</span></td>
          <td><span class="sector-chip">${s?.ja ?? c.sector}</span></td>
          <td colspan="8" class="na">データ取得エラー</td></tr>`;
      }
      return `<tr>
        <td>${c.ja}<span class="tk">${c.ticker}</span><span class="tier tier${c.tier}">${c.tier === 1 ? "主力" : "2軍"}</span>${sourceBadge(c.data_source)}</td>
        <td><span class="sector-chip" style="border-color:${s?.color}55">${s?.ja ?? c.sector}</span></td>
        <td class="num">${fmtCap(c.market_cap, c.currency)}</td>
        <td class="num">${pct(c.returns?.["1m"])}</td>
        <td class="num">${pct(c.returns?.["3m"])}</td>
        <td class="num">${pct(c.capex_yoy, 0)}</td>
        <td class="num">${pct(c.rev_yoy, 0)}</td>
        <td class="num">${pct(c.rd_yoy, 0)}</td>
        <td class="num">${c.capex_intensity == null ? '<span class="na">—</span>' : (c.capex_intensity * 100).toFixed(0) + "%"}</td>
        <td class="num">${buzzCell(c)}</td>
      </tr>`;
    })
    .join("");
  const label = sectorFilter ? `絞り込み: ${secMap[sectorFilter]?.ja} ×` : "";
  $("#table-filter-label").textContent = label;
}

/* ---------- ニュース ---------- */
function renderNews() {
  const secMap = Object.fromEntries(SNAP.sectors.map((s) => [s.id, s]));
  const items = SNAP.news
    .filter((n) => !sectorFilter || n.sectors.includes(sectorFilter))
    .slice(0, 60);
  $("#news-list").innerHTML = items.length
    ? items
        .map(
          (n) => `
      <div class="news-item">
        <span class="news-time">${timeAgo(n.published)}</span>
        <span class="news-title">
          <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>
          <span class="news-source">${n.source || ""}</span>
        </span>
        <span class="news-chips">${n.sectors
          .slice(0, 3)
          .map((s) => `<span class="sector-chip" style="border-color:${secMap[s]?.color}55">${secMap[s]?.ja ?? s}</span>`)
          .join("")}</span>
      </div>`
        )
        .join("")
    : '<div class="na" style="padding:12px">該当ニュースなし</div>';
  $("#news-filter-label").textContent = sectorFilter ? `絞り込み: ${secMap[sectorFilter]?.ja} ×` : "";
}

/* ================= 3D マネーフロー・ファネル (ヒーロー) =================
   バリューチェーンの上流(資金源=ハイパースケーラー)から下流(部材・装置)へ、
   お金がカスケードで流れ落ちる立体ファネル。
   - 各段の太さ = 今その領域に集まっている資金量（ヒートスコア）
   - 下降する光の粒 = 資金がチェーンを流れ落ちる様子
   - 上向き▲ = その領域に資金が流入中（CAPEX前年比が高い）
*/
const FUNNEL_FLOW = [
  { id: "hyperscaler", short: "ハイパースケーラー", tag: "資金源" },
  { id: "power",       short: "電力・DC・サーバー", tag: "" },
  { id: "optical",     short: "光通信・インターコネクト", tag: "" },
  { id: "cable",       short: "電線・銅・ケーブル", tag: "" },
  { id: "gpu",         short: "GPU・AI半導体", tag: "" },
  { id: "memory",      short: "メモリ・ストレージ", tag: "" },
  { id: "foundry",     short: "ファウンドリ・IDM", tag: "" },
  { id: "equipment",   short: "半導体製造装置", tag: "部材・装置" },
];

const Funnel = {
  canvas: null, ctx: null, container: null,
  sectors: {}, tiers: [], hitboxes: [], particles: [],
  hover: null, dpr: 1, w: 0, h: 0, started: false,

  init() {
    this.canvas = document.getElementById("funnel-canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.container = document.getElementById("funnel-hero");
    for (let i = 0; i < 130; i++) {
      this.particles.push({
        p: Math.random(), s: 0.55 + Math.random() * 1.1,
        seed: Math.random() * 100, off: Math.random(),
      });
    }
    this.canvas.addEventListener("mousemove", (e) => this.onMove(e));
    this.canvas.addEventListener("mouseleave", () => {
      this.hover = null; this.canvas.style.cursor = "default";
    });
    this.canvas.addEventListener("click", () => this.onClick());
    if (!this.started) { this.started = true; requestAnimationFrame(() => this.loop()); }
  },

  setData(sectors) {
    this.sectors = Object.fromEntries(sectors.map((s) => [s.id, s]));
  },

  loop() { this.resize(); this.draw(); requestAnimationFrame(() => this.loop()); },

  resize() {
    if (!this.canvas) return;
    // レイアウトサイズはCSS(width:100%/height:100%、モバイルではflex:1)に任せきりにする。
    // ここでinline style幅を書き戻すと「自分が書いた値を自分で測る」自己参照ループになり、
    // ビューポートが変わってもサイズ変化を検知できなくなる（実際に起きたバグ）。
    const rect = this.canvas.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;
    const dpr = window.devicePixelRatio || 1;
    if (cw !== this.w || ch !== this.h || dpr !== this.dpr) {
      this.w = cw; this.h = ch; this.dpr = dpr;
      this.canvas.width = cw * dpr; this.canvas.height = ch * dpr;
    }
  },

  layout() {
    const flow = FUNNEL_FLOW.filter((f) => this.sectors[f.id]);
    const n = flow.length;
    if (!n || !this.w) { this.tiers = []; return; }
    this.mobile = this.w < 640;
    const topY = this.h * (this.mobile ? 0.075 : 0.17);
    const botY = this.h * (this.mobile ? 0.96 : 0.9);
    const gap = (botY - topY) / (n - 1);
    const rMax = this.mobile ? Math.min(this.w * 0.30, 92) : Math.min(this.w * 0.24, 180);
    const rMin = this.mobile ? 14 : 24;
    const cx = this.w / 2;
    const t = performance.now() / 1000;

    // 全リング共通の回転位相：コイン回転トリックで横幅を周期的に伸縮させ、
    // ひとつの剛体オブジェクトがゆっくり回っているように見せる（真横〜斜め視点）
    const ROT_PERIOD = 22; // 秒/1回転
    this.rot = (t / ROT_PERIOD) * Math.PI * 2;
    const spinSquash = 0.62 + 0.38 * Math.abs(Math.cos(this.rot));
    // カメラの上下チルトもゆっくり変化させ、真横寄りの視点を演出
    const tiltT = t / 55;
    const tiltRatio = 0.24 + 0.10 * (0.5 + 0.5 * Math.sin(tiltT));

    this.tiers = flow.map((f, i) => {
      const sec = this.sectors[f.id];
      const heat = Math.max(0, Math.min(100, sec.heat));
      const breathe = 1 + 0.02 * Math.sin(t * 1.4 + i);
      const r = (rMin + (heat / 100) * (rMax - rMin)) * breathe;
      return { ...f, sec, heat, cx, cy: topY + i * gap,
               r, rx: r * spinSquash, ry: r * tiltRatio,
               capex: sec.capex_yoy, capexUsd: sec.capex_usd };
    });
    const maxIn = Math.max(...this.tiers.map((x) => x.capex || 0), 0.0001);
    this.tiers.forEach((x) => { x.inflowN = x.capex != null ? Math.max(0, x.capex) / maxIn : 0; });

    // 実際のCAPEX金額(USD換算)による重み。粒子の速度・太さ・輝きに反映する
    const usdVals = this.tiers.map((x) => x.capexUsd).filter((v) => v);
    const maxUsd = Math.max(...usdVals, 1), minUsd = Math.min(...usdVals, maxUsd);
    this.tiers.forEach((x) => {
      x.capexW = x.capexUsd
        ? 0.15 + 0.85 * ((x.capexUsd - minUsd) / Math.max(1, maxUsd - minUsd))
        : 0.15;
    });
  },

  draw() {
    const ctx = this.ctx; if (!ctx) return;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);
    this.layout();
    if (!this.tiers.length) { ctx.restore(); return; }
    const t = performance.now() / 1000;

    const bg = ctx.createRadialGradient(this.w / 2, this.h * 0.46, 8, this.w / 2, this.h * 0.5, this.h * 0.72);
    bg.addColorStop(0, "rgba(48,68,112,0.20)");
    bg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, this.w, this.h);

    const hottest = this.tiers.reduce((a, b) => (b.heat > a.heat ? b : a), this.tiers[0]);
    for (let i = 0; i < this.tiers.length - 1; i++) this.drawBand(this.tiers[i], this.tiers[i + 1]);
    this.drawParticles();

    this.hitboxes = [];
    this.tiers.forEach((tier, i) => {
      const active = sectorFilter === tier.id;
      const hovered = this.hover === tier.id;
      this.drawRing(tier, { active, hovered, isHot: tier.id === hottest.id, t });
      this.drawLabel(tier, i, { active, hovered });
      this.hitboxes.push({ id: tier.id, cx: tier.cx, cy: tier.cy, r: tier.rx, ry: tier.ry });
    });
    ctx.restore();
  },

  drawBand(a, b) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, a.cy, 0, b.cy);
    grad.addColorStop(0, hexA(a.sec.color, 0.4));
    grad.addColorStop(1, hexA(b.sec.color, 0.4));
    ctx.beginPath();
    ctx.moveTo(a.cx - a.rx, a.cy);
    ctx.lineTo(b.cx - b.rx, b.cy);
    ctx.quadraticCurveTo(b.cx, b.cy + b.ry * 1.4, b.cx + b.rx, b.cy);
    ctx.lineTo(a.cx + a.rx, a.cy);
    ctx.quadraticCurveTo(a.cx, a.cy + a.ry * 1.4, a.cx - a.rx, a.cy);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = hexA("#ffffff", 0.05); ctx.lineWidth = 1; ctx.stroke();
  },

  drawRing(tier, o) {
    const ctx = this.ctx, col = tier.sec.color;
    const pulse = o.isHot ? 0.6 + 0.4 * Math.sin(o.t * 3) : 1;
    const rg = ctx.createRadialGradient(tier.cx, tier.cy, 1, tier.cx, tier.cy, tier.rx);
    rg.addColorStop(0, hexA(col, 0.55));
    rg.addColorStop(0.7, hexA(col, 0.2));
    rg.addColorStop(1, hexA(col, 0.04));
    ctx.beginPath();
    ctx.ellipse(tier.cx, tier.cy, tier.rx, tier.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = rg; ctx.fill();

    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = (o.hovered ? 36 : o.isHot ? 26 : 15) * pulse;
    ctx.lineWidth = o.active || o.hovered ? 3 : 2;
    ctx.strokeStyle = brighten(col, o.hovered ? 0.5 : 0.28);
    ctx.beginPath();
    ctx.ellipse(tier.cx, tier.cy, tier.rx, tier.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 回転に伴うスペキュラーハイライト（光沢が円周を滑らかに一周する）
    const hlPhase = this.rot % (Math.PI * 2);
    const hlX = tier.cx + Math.cos(hlPhase) * tier.rx * 0.72;
    const hlY = tier.cy - Math.sin(hlPhase) * tier.ry * 0.5 - tier.ry * 0.15;
    const hl = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, tier.rx * 0.4);
    hl.addColorStop(0, hexA("#ffffff", 0.35 * (0.5 + 0.5 * Math.abs(Math.cos(this.rot)))));
    hl.addColorStop(1, hexA("#ffffff", 0));
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.ellipse(tier.cx, tier.cy, tier.rx, tier.ry, 0, 0, Math.PI * 2); ctx.fill();

    if (tier.inflowN > 0.4) this.drawInflow(tier, o.t);

    if (o.active) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(tier.cx, tier.cy, tier.rx + 6, tier.ry + 3, 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.restore();
    }
  },

  drawInflow(tier, t) {
    const ctx = this.ctx, baseX = tier.cx + tier.rx + 14;
    for (let k = 0; k < 3; k++) {
      const ph = (t * 1.4 + k / 3) % 1;
      const y = tier.cy + 15 - ph * 28;
      ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
      ctx.fillStyle = "#7fffc0";
      ctx.beginPath();
      ctx.moveTo(baseX, y); ctx.lineTo(baseX - 5, y + 7); ctx.lineTo(baseX + 5, y + 7);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawParticles() {
    const ctx = this.ctx;
    const top = this.tiers[0].cy, bot = this.tiers[this.tiers.length - 1].cy, span = bot - top;
    const dt = 0.006;
    for (const pt of this.particles) {
      const y0 = top + pt.p * span;
      const localSpeed = 0.5 + 1.7 * this.weightAt(y0); // 実際のCAPEX額が大きいほど速く流れる
      pt.p += pt.s * localSpeed * dt;
      if (pt.p > 1) pt.p -= 1;
      const y = top + pt.p * span;
      const R = this.radiusAt(y);
      const w = this.weightAt(y); // 0.15〜1.0、その地点の実CAPEX額の重み
      const x = this.cxAt(y) + Math.sin(pt.p * 11 + pt.seed) * R * 0.55 * (pt.off * 0.8 + 0.2);
      const size = 1.1 + w * 2.1; // 資金流入が大きいほど粒が太く見える
      ctx.save();
      ctx.shadowColor = "#cfe4ff"; ctx.shadowBlur = 5 + w * 8;
      ctx.globalAlpha = (0.4 + 0.55 * Math.sin(pt.p * Math.PI)) * (0.55 + 0.45 * w);
      ctx.fillStyle = "#eaf3ff";
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  },

  radiusAt(y) {
    const ts = this.tiers;
    if (y <= ts[0].cy) return ts[0].rx;
    for (let i = 0; i < ts.length - 1; i++)
      if (y >= ts[i].cy && y <= ts[i + 1].cy) {
        const f = (y - ts[i].cy) / (ts[i + 1].cy - ts[i].cy);
        return ts[i].rx + (ts[i + 1].rx - ts[i].rx) * f;
      }
    return ts[ts.length - 1].rx;
  },
  cxAt(y) {
    const ts = this.tiers;
    if (y <= ts[0].cy) return ts[0].cx;
    for (let i = 0; i < ts.length - 1; i++)
      if (y >= ts[i].cy && y <= ts[i + 1].cy) {
        const f = (y - ts[i].cy) / (ts[i + 1].cy - ts[i].cy);
        return ts[i].cx + (ts[i + 1].cx - ts[i].cx) * f;
      }
    return ts[ts.length - 1].cx;
  },
  weightAt(y) {
    const ts = this.tiers;
    if (y <= ts[0].cy) return ts[0].capexW;
    for (let i = 0; i < ts.length - 1; i++)
      if (y >= ts[i].cy && y <= ts[i + 1].cy) {
        const f = (y - ts[i].cy) / (ts[i + 1].cy - ts[i].cy);
        return ts[i].capexW + (ts[i + 1].capexW - ts[i].capexW) * f;
      }
    return ts[ts.length - 1].capexW;
  },

  drawLabel(tier, i, o) {
    const ctx = this.ctx;
    const cap = tier.capex == null ? "—" : (tier.capex >= 0 ? "+" : "") + (tier.capex * 100).toFixed(0) + "%";
    const tagStr = tier.tag ? tier.tag + " ・ " : "";
    const arrow = tier.inflowN > 0.4 ? " ▲流入" : "";

    if (this.mobile) {
      // スマホ幅：リングの真下にラベルを1〜2行で中央寄せ（左右の余白が無いため）
      const line1 = tier.short;
      const line2 = `ヒート${tier.heat} ・ CAPEX ${cap}${arrow}`;
      const ly = tier.cy + tier.ry + 15;
      ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.font = "600 11.5px 'Hiragino Sans', sans-serif";
      ctx.fillStyle = o.hovered || o.active ? "#fff" : "#e6e9ef";
      ctx.fillText(line1, tier.cx, ly);
      ctx.font = "10px 'Hiragino Sans', sans-serif";
      ctx.fillStyle = "#9aa4b8";
      ctx.fillText(line2, tier.cx, ly + 13);
      return;
    }

    const rightSide = i % 2 === 0, pad = 12;
    const line1 = tier.short;
    const line2 = `${tagStr}ヒート${tier.heat} ・ CAPEX ${cap}${arrow}`;

    // 文字幅を測ってキャンバス内に必ず収まるガター位置を決める
    ctx.font = "600 13px 'Hiragino Sans', sans-serif";
    const w1 = ctx.measureText(line1).width;
    ctx.font = "12px 'Hiragino Sans', sans-serif";
    const w2 = ctx.measureText(line2).width;
    const tw = Math.max(w1, w2);
    const anchorX = rightSide ? this.w - pad - tw : pad;

    // リーダー線（リング端 → ラベルブロック内側）
    const edgeX = tier.cx + (rightSide ? tier.r : -tier.r);
    const leaderEndX = rightSide ? anchorX - 8 : anchorX + tw + 8;
    ctx.strokeStyle = hexA(tier.sec.color, 0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(edgeX, tier.cy); ctx.lineTo(leaderEndX, tier.cy); ctx.stroke();

    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.font = "600 13px 'Hiragino Sans', sans-serif";
    ctx.fillStyle = o.hovered || o.active ? "#fff" : "#e6e9ef";
    ctx.fillText(line1, anchorX, tier.cy - 8);
    ctx.font = "12px 'Hiragino Sans', sans-serif";
    ctx.fillStyle = "#9aa4b8";
    ctx.fillText(line2, anchorX, tier.cy + 9);
  },

  onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let found = null;
    for (const h of this.hitboxes) {
      const dx = (x - h.cx) / (h.r + 8), dy = (y - h.cy) / (h.ry + 8);
      if (dx * dx + dy * dy <= 1) { found = h.id; break; }
    }
    this.hover = found;
    this.canvas.style.cursor = found ? "pointer" : "default";
  },

  onClick() {
    if (!this.hover) return;
    sectorFilter = sectorFilter === this.hover ? null : this.hover;
    renderSectors(); renderTable(); renderNews();
  },
};

/* ---------- 全体描画 ---------- */
function renderAll() {
  const dt = new Date(SNAP.generated_at);
  $("#generated-at").textContent = `最終更新: ${dt.toLocaleString("ja-JP")}`;
  renderSummary();
  renderSectors();
  Funnel.setData(SNAP.sectors);
  renderHyperChart();
  renderSectorCapexChart();
  renderTaiwanChart();
  renderTable();
  renderNews();
  $("#loading").classList.add("hidden");
  $("#main").classList.remove("hidden");
}

async function loadSnapshot() {
  const res = await fetch("/api/snapshot");
  if (!res.ok) return false;
  SNAP = await res.json();
  renderAll();
  return true;
}

/* ---------- 更新ポーリング ---------- */
let polling = false;
async function pollStatus() {
  if (polling) return;
  polling = true;
  const banner = $("#fetch-banner");
  const btn = $("#refresh-btn");
  try {
    while (true) {
      const st = await (await fetch("/api/status")).json();
      if (st.fetching) {
        banner.classList.remove("hidden", "error");
        banner.textContent = `データ更新中... ${st.progress || ""}`;
        btn.disabled = true;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      btn.disabled = false;
      if (st.error) {
        banner.classList.remove("hidden");
        banner.classList.add("error");
        banner.textContent = `更新エラー: ${st.error}`;
      } else {
        banner.classList.add("hidden");
        await loadSnapshot();
      }
      break;
    }
  } finally {
    polling = false;
  }
}

$("#refresh-btn").onclick = async () => {
  await fetch("/api/refresh", { method: "POST" });
  pollStatus();
};

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.onclick = () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir *= -1;
    else { sortKey = k; sortDir = -1; }
    renderTable();
  };
});

(async () => {
  chartDefaults();
  Funnel.init();
  const ok = await loadSnapshot();
  if (!ok) {
    $("#loading").textContent = "初回データを取得しています（1〜2分かかります）...";
    await fetch("/api/refresh", { method: "POST" });
  }
  pollStatus();
})();
