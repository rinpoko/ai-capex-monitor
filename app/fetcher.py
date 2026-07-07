# 財務データ（yfinance）とニュース（Google News RSS）を収集し、
# data/snapshot.json に可視化用スナップショットを書き出す。
import json
import math
import re
import shutil
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

import yfinance as yf

from .companies import (
    COMPANIES, SECTORS, NEWS_QUERIES, COMPANY_ALIASES, SECTOR_KEYWORDS,
    HYPERSCALER_CHART,
)
from . import edgar, edinet, social, taiwan

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
SNAPSHOT = DATA / "snapshot.json"


def _f(x):
    """NaN/inf を None に落として JSON 安全な float にする。"""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def _qkey(ts):
    return (ts.year, (ts.month - 1) // 3 + 1)


def _qlabel(key):
    return f"{key[0]}Q{key[1]}"


def _row(df, name):
    if df is None or df.empty or name not in df.index:
        return {}
    out = {}
    for col, val in df.loc[name].items():
        v = _f(val)
        if v is not None:
            out[_qkey(col)] = v
    return out


def _yoy(series):
    """同一暦四半期の前年同期比。直近の比較可能な四半期で計算する。"""
    for key in sorted(series.keys(), reverse=True):
        prev = (key[0] - 1, key[1])
        if prev in series and series[prev]:
            base = abs(series[prev])
            if base > 0:
                return (abs(series[key]) - base) / base, key
    return None, None


def fetch_company(c):
    out = dict(c)
    out["error"] = None
    try:
        t = yf.Ticker(c["ticker"])

        # 株価リターン
        hist = t.history(period="6mo")["Close"].dropna()
        px = hist.tolist()
        out["price"] = _f(px[-1]) if px else None
        out["returns"] = {}
        for label, n in (("1w", 5), ("1m", 21), ("3m", 63)):
            out["returns"][label] = _f(px[-1] / px[-1 - n] - 1) if len(px) > n else None

        fi = t.fast_info
        out["market_cap"] = _f(getattr(fi, "market_cap", None))
        out["currency"] = getattr(fi, "currency", None)  # 取引通貨（株価・時価総額用）

        # 財務諸表の計上通貨は取引通貨と異なることがある（例: TSM/UMCはUSD建てADRだが
        # 財務諸表はTWD、ASMLはUSD建てADRだが財務諸表はEUR）。CAPEX等の実額換算は
        # financialCurrencyを使う。取得できなければ取引通貨にフォールバック。
        try:
            out["financial_currency"] = t.get_info().get("financialCurrency") or out["currency"]
        except Exception:
            out["financial_currency"] = out["currency"]

        cf = t.quarterly_cashflow
        inc = t.quarterly_income_stmt
        capex = {k: abs(v) for k, v in _row(cf, "Capital Expenditure").items()}
        ocf = _row(cf, "Operating Cash Flow")
        rev = _row(inc, "Total Revenue")
        rd = _row(inc, "Research And Development")

        # 日本企業などは四半期キャッシュフローが無いため年次にフォールバック
        out["period"] = "quarterly"
        if not capex:
            acf = t.cashflow
            ainc = t.income_stmt
            capex = {k: abs(v) for k, v in _row(acf, "Capital Expenditure").items()}
            ocf = _row(acf, "Operating Cash Flow")
            rev = _row(ainc, "Total Revenue")
            rd = _row(ainc, "Research And Development")
            out["period"] = "annual"

        label = (lambda k: f"FY{k[0]}") if out["period"] == "annual" else _qlabel
        keys = sorted(set(capex) | set(rev) | set(rd) | set(ocf))[-9:]
        out["quarters"] = [
            {
                "q": label(k),
                "capex": capex.get(k),
                "rev": rev.get(k),
                "rd": rd.get(k),
                "ocf": ocf.get(k),
            }
            for k in keys
        ]

        out["capex_yoy"], _ = _yoy(capex)
        out["rev_yoy"], _ = _yoy(rev)
        out["rd_yoy"], _ = _yoy(rd)

        lk = max(capex.keys() & rev.keys(), default=None)
        out["capex_intensity"] = (
            capex[lk] / rev[lk] if lk and rev[lk] else None
        )
        out["latest_q"] = label(max(keys)) if keys else None
        out["data_source"] = "Yahoo Finance" if out["period"] == "quarterly" else "Yahoo Finance（年次）"
    except Exception as e:  # 個別銘柄の失敗で全体を止めない
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def _enrich_with_edgar(c):
    """SEC EDGARの一次情報が取れる米国上場企業は、それをCAPEX/売上/R&Dの正本として採用する。"""
    if c["error"]:
        return c
    try:
        edgar_data = edgar.fetch_company_edgar(c["ticker"])
    except Exception:
        edgar_data = None
    if not edgar_data:
        return c
    c["quarters"] = edgar_data["quarters"]
    c["capex_yoy"] = edgar_data["capex_yoy"]
    c["rev_yoy"] = edgar_data["rev_yoy"]
    c["rd_yoy"] = edgar_data["rd_yoy"]
    lk = None
    for q in reversed(edgar_data["quarters"]):
        if q.get("capex") and q.get("rev"):
            lk = q
            break
    c["capex_intensity"] = (lk["capex"] / lk["rev"]) if lk else c.get("capex_intensity")
    c["latest_q"] = edgar_data["quarters"][-1]["q"] if edgar_data["quarters"] else c.get("latest_q")
    c["data_source"] = "SEC EDGAR"
    return c


def _google_news(query, lang, limit=12):
    if lang == "ja":
        params = "hl=ja&gl=JP&ceid=JP:ja"
    else:
        params = "hl=en-US&gl=US&ceid=US:en"
    url = (
        "https://news.google.com/rss/search?q="
        + urllib.parse.quote(query)
        + "&" + params
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        root = ET.fromstring(resp.read())
    items = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        src = item.find("{*}source")
        source = src.text.strip() if src is not None and src.text else ""
        pub = item.findtext("pubDate")
        try:
            published = parsedate_to_datetime(pub).astimezone(timezone.utc)
        except Exception:
            published = None
        if title:
            items.append(
                {"title": title, "link": link, "source": source,
                 "published": published.isoformat() if published else None,
                 "lang": lang}
            )
        if len(items) >= limit:
            break
    return items


def _tag_news(item, query_sectors):
    text = item["title"].lower()
    sectors = set(query_sectors)
    companies = []
    for ticker, aliases in COMPANY_ALIASES.items():
        if any(a in text for a in aliases):
            companies.append(ticker)
            sectors.add(next(c["sector"] for c in COMPANIES if c["ticker"] == ticker))
    for sec, kws in SECTOR_KEYWORDS.items():
        if any(kw in text for kw in kws):
            sectors.add(sec)
    item["sectors"] = sorted(sectors)
    item["companies"] = companies
    return item


def fetch_news(progress=lambda m: None):
    seen = set()
    all_items = []
    for i, nq in enumerate(NEWS_QUERIES):
        progress(f"ニュース取得中 ({i + 1}/{len(NEWS_QUERIES)}): {nq['q']}")
        try:
            items = _google_news(nq["q"], nq["lang"])
        except Exception:
            continue
        for it in items:
            key = re.sub(r"\W+", "", it["title"].lower())[:80]
            if key in seen:
                continue
            seen.add(key)
            all_items.append(_tag_news(it, nq["sectors"]))
    all_items.sort(key=lambda x: x["published"] or "", reverse=True)
    return all_items[:150]


def _norm(values):
    """0..1 に正規化。全て同値なら 0.5。"""
    vals = [v for v in values.values() if v is not None]
    if not vals or max(vals) == min(vals):
        return {k: 0.5 for k in values}
    lo, hi = min(vals), max(vals)
    return {
        k: ((v - lo) / (hi - lo) if v is not None else 0.5)
        for k, v in values.items()
    }


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


# ダッシュボード内での概算換算用（簡易レート）
_FX_TO_USD = {"JPY": 1 / 150, "KRW": 1 / 1400, "TWD": 1 / 32, "EUR": 1.08, "USD": 1.0}


def _latest_capex_usd(c):
    """その企業の直近四半期(または年次)CAPEXをUSD換算した概算値。
    財務諸表の計上通貨(financial_currency)を使う（取引通貨とは異なる場合があるため）。"""
    quarters = c.get("quarters") or []
    for q in reversed(quarters):
        if q.get("capex"):
            ccy = c.get("financial_currency") or c.get("currency")
            fx = _FX_TO_USD.get(ccy, 1.0)
            return abs(q["capex"]) * fx
    return None


def build_sectors(companies, news):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    capex_med, mom_med, news_cnt, capex_usd = {}, {}, {}, {}
    for sec in SECTORS:
        cs = [c for c in companies if c["sector"] == sec and not c["error"]]
        capex_med[sec] = _median([c.get("capex_yoy") for c in cs])
        mom_med[sec] = _median([(c.get("returns") or {}).get("1m") for c in cs])
        news_cnt[sec] = sum(
            1 for n in news
            if sec in n["sectors"] and (n["published"] or "") >= cutoff
        )
        usd_vals = [_latest_capex_usd(c) for c in cs]
        capex_usd[sec] = sum(v for v in usd_vals if v) or None
    n_capex = _norm(capex_med)
    n_mom = _norm(mom_med)
    n_news = _norm({k: float(v) for k, v in news_cnt.items()})

    out = []
    for sec, meta in SECTORS.items():
        heat = round(100 * (0.4 * n_capex[sec] + 0.4 * n_mom[sec] + 0.2 * n_news[sec]))
        out.append({
            "id": sec,
            "ja": meta["ja"],
            "color": meta["color"],
            "heat": heat,
            "capex_yoy": capex_med[sec],
            "momentum_1m": mom_med[sec],
            "news_7d": news_cnt[sec],
            "capex_usd": capex_usd[sec],
        })
    out.sort(key=lambda s: -s["heat"])
    return out


def build_hyperscaler_chart(companies):
    by_ticker = {c["ticker"]: c for c in companies}
    qset = set()
    series = {}
    for tk in HYPERSCALER_CHART:
        c = by_ticker.get(tk)
        if not c or c["error"]:
            continue
        vals = {q["q"]: q["capex"] for q in c.get("quarters", []) if q["capex"]}
        series[tk] = vals
        qset |= set(vals)
    # 決算期ズレで一部企業しか報告していない四半期は集計から外す
    n = len(series)
    counts = {q: sum(1 for t in series if q in series[t]) for q in qset}
    quarters = sorted(q for q in qset if counts[q] >= max(1, n - 1))[-8:]

    headline = next(
        (q for q in reversed(quarters) if counts[q] == n),
        quarters[-1] if quarters else None,
    )
    total_latest = yoy = None
    if headline:
        prev = f"{int(headline[:4]) - 1}{headline[4:]}"
        both = [t for t in series if headline in series[t] and prev in series[t]]
        cur_sum = sum(series[t][headline] for t in both)
        prev_sum = sum(series[t][prev] for t in both)
        total_latest = sum(series[t][headline] for t in series if headline in series[t]) or None
        yoy = (cur_sum - prev_sum) / prev_sum if prev_sum else None
    return {
        "quarters": quarters,
        "headline_q": headline,
        "series": [
            {"ticker": tk, "ja": by_ticker[tk]["ja"],
             "values": [series[tk].get(q) for q in quarters]}
            for tk in series
        ],
        "total_latest": total_latest,
        "total_yoy": yoy,
    }


def build_snapshot(progress=lambda m: None):
    progress("財務データ取得中 (0/%d)" % len(COMPANIES))
    companies = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(fetch_company, c): c for c in COMPANIES}
        for i, fut in enumerate(as_completed(futures)):
            companies.append(fut.result())
            progress(f"財務データ取得中 ({i + 1}/{len(COMPANIES)})")
    order = {c["ticker"]: i for i, c in enumerate(COMPANIES)}
    companies.sort(key=lambda c: order[c["ticker"]])

    progress("SEC EDGARで米国企業データを検証中...")
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {ex.submit(_enrich_with_edgar, c): c["ticker"] for c in companies}
        for fut in as_completed(futures):
            fut.result()

    news = fetch_news(progress)

    progress("EDINET開示情報を確認中...")
    try:
        news = edinet.fetch_edinet_disclosures(COMPANIES) + news
    except Exception:
        pass

    progress("SNSセンチメントを取得中 (Reddit / StockTwits)...")
    try:
        reddit_buzz = social.fetch_reddit_buzz()
    except Exception:
        reddit_buzz = None
    try:
        stocktwits = social.fetch_stocktwits_sentiment([c["ticker"] for c in companies])
    except Exception:
        stocktwits = {}
    for c in companies:
        c["reddit_mentions_7d"] = (reddit_buzz or {}).get(c["ticker"])
        c["stocktwits"] = stocktwits.get(c["ticker"])

    progress("台湾TWSE 月次売上を取得中 (TSMC/UMC)...")
    try:
        taiwan_revenue = taiwan.fetch_taiwan_revenue()
    except Exception:
        taiwan_revenue = []

    sectors = build_sectors(companies, news)

    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "companies": companies,
        "sectors": sectors,
        "news": news,
        "hyperscaler_capex": build_hyperscaler_chart(companies),
        "taiwan_revenue": taiwan_revenue,
        "reddit_available": reddit_buzz is not None,
        "edinet_available": bool(edinet.API_KEY),
    }

    DATA.mkdir(parents=True, exist_ok=True)
    tmp = SNAPSHOT.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SNAPSHOT)

    hist_dir = DATA / "history"
    hist_dir.mkdir(exist_ok=True)
    shutil.copy(SNAPSHOT, hist_dir / f"{datetime.now():%Y-%m-%d}.json")
    progress("完了")
    return snapshot


if __name__ == "__main__":
    build_snapshot(progress=print)
