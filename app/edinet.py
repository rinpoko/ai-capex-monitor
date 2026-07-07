# EDINET (金融庁) — 日本企業の開示書類（有価証券報告書・半期報告書等）を
# 提出直後に検知してニュース欄へ統合する。無料だがAPIキー登録が必要（任意機能）。
# 未設定の場合は何もせず静かにスキップする。
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API_KEY = os.environ.get("EDINET_API_KEY", "").strip()
DOC_LIST_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"
VIEWER_URL = "https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx?LinkType=2&Lcc=1&docID={doc_id}"

# 財務・決算関連として意味のある書類種別のみ拾う（大量保有報告書などのノイズを除外）
FORM_CODES = {
    "030000": "有価証券報告書",
    "050001": "半期報告書",
    "043000": "四半期報告書",
    "070000": "臨時報告書",
}

LOOKBACK_DAYS = 10


def _sec_code_of(ticker):
    if not ticker.endswith(".T"):
        return None
    return ticker[:-2]


def _fetch_day(day):
    params = urllib.parse.urlencode({"date": day, "type": 2, "Subscription-Key": API_KEY})
    req = urllib.request.Request(f"{DOC_LIST_URL}?{params}", headers={"User-Agent": "ai-capex-monitor/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def fetch_edinet_disclosures(companies):
    """companies: build_snapshot に渡す COMPANIES 相当のリスト。ticker->secCode で突合する。"""
    if not API_KEY:
        return []

    sec_map = {}
    for c in companies:
        sc = _sec_code_of(c["ticker"])
        if sc:
            sec_map[sc] = c

    items = []
    today = datetime.now(timezone.utc).date()
    for i in range(LOOKBACK_DAYS):
        day = (today - timedelta(days=i)).isoformat()
        try:
            data = _fetch_day(day)
        except Exception:
            continue
        for doc in data.get("results", []):
            form = doc.get("formCode")
            if form not in FORM_CODES:
                continue
            raw_sec = (doc.get("secCode") or "").strip()
            sec_code = raw_sec[:-1] if len(raw_sec) == 5 and raw_sec.endswith("0") else raw_sec
            company = sec_map.get(sec_code)
            if not company:
                continue
            submitted = doc.get("submitDateTime")
            try:
                published = datetime.strptime(submitted, "%Y-%m-%d %H:%M").replace(
                    tzinfo=timezone.utc
                ).isoformat()
            except (TypeError, ValueError):
                published = None
            items.append({
                "title": f"[EDINET開示] {company['ja']}: {doc.get('docDescription') or FORM_CODES[form]}",
                "link": VIEWER_URL.format(doc_id=doc.get("docID", "")),
                "source": "EDINET",
                "published": published,
                "lang": "ja",
                "sectors": [company["sector"]],
                "companies": [company["ticker"]],
            })
    return items
