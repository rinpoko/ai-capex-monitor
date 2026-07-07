# Reddit / StockTwits — 決算・記事には出にくい「知る人ぞ知る」系のリテール温度感。
# 両方とも無料・APIキー不要（公開JSONエンドポイント）。
# Redditはデータセンター系IPからブロックされることがあるため失敗時は静かにスキップする。
import json
import re
import urllib.request
from datetime import datetime, timezone, timedelta

from .companies import COMPANY_ALIASES

REDDIT_UA = "ai-capex-monitor/1.0 (research use; contact mail@rinshiro.com)"
SUBREDDITS = ["semiconductors", "hardware", "stocks", "investing", "wallstreetbets"]


def _get_json(url, headers, timeout=15):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def fetch_reddit_buzz():
    """直近7日のサブレディット新着投稿から企業エイリアスの出現回数を集計する。"""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).timestamp()
    counts = {ticker: 0 for ticker in COMPANY_ALIASES}
    ok = False
    for sub in SUBREDDITS:
        try:
            data = _get_json(
                f"https://www.reddit.com/r/{sub}/new.json?limit=100",
                {"User-Agent": REDDIT_UA},
            )
        except Exception:
            continue
        ok = True
        for child in data.get("data", {}).get("children", []):
            post = child.get("data", {})
            if post.get("created_utc", 0) < cutoff:
                continue
            text = f"{post.get('title', '')} {post.get('selftext', '')}".lower()
            for ticker, aliases in COMPANY_ALIASES.items():
                if any(a in text for a in aliases):
                    counts[ticker] += 1
    if not ok:
        return None  # 全滝ならネットワーク遮断とみなしフィールド自体を出さない
    return {t: c for t, c in counts.items() if c > 0}


def fetch_stocktwits_sentiment(tickers):
    """米国上場ティッカーのみ対象。直近メッセージのブル/ベア比率と件数を返す。"""
    out = {}
    for ticker in tickers:
        if "." in ticker:  # 東証・韓国取引所はStockTwitsのシンボル体系と不一致
            continue
        try:
            data = _get_json(
                f"https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json",
                {"User-Agent": "Mozilla/5.0"},
            )
        except Exception:
            continue
        msgs = data.get("messages", [])
        tagged = [
            m["entities"]["sentiment"]["basic"]
            for m in msgs
            if m.get("entities", {}).get("sentiment")
        ]
        if not tagged:
            continue
        bullish = sum(1 for s in tagged if s == "Bullish")
        out[ticker] = {
            "message_count": len(msgs),
            "tagged_count": len(tagged),
            "bullish_pct": bullish / len(tagged),
        }
    return out
