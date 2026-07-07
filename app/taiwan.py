# 台湾証券取引所 OpenAPI — TSMC/UMCの月次売上（無料・APIキー不要）。
# 決算を待たずに毎月10日前後で更新される先行指標。
# 1回のAPI呼び出しは「その時点の最新月」の断面データのみを返すため、
# 呼び出す都度 data/taiwan_revenue_history.json に積み上げて時系列を作る。
import json
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
HISTORY_FILE = DATA / "taiwan_revenue_history.json"
URL = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"

TARGETS = {"2330": "TSM", "2303": "UMC"}


def _roc_to_iso(yyymm):
    """民国年月 (例 '11505') -> 'YYYY-MM'"""
    roc_year = int(yyymm[:-2])
    month = yyymm[-2:]
    return f"{roc_year + 1911}-{month}"


def fetch_taiwan_revenue():
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "ai-capex-monitor/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            rows = json.loads(resp.read())
    except Exception:
        rows = []

    history = {}
    if HISTORY_FILE.exists():
        try:
            history = json.loads(HISTORY_FILE.read_text())
        except Exception:
            history = {}

    for row in rows:
        code = row.get("公司代號")
        if code not in TARGETS:
            continue
        ticker = TARGETS[code]
        month = _roc_to_iso(row.get("資料年月", ""))
        try:
            rev_ntd_thousand = float(row.get("營業收入-當月營收") or 0)
            yoy = float(row.get("營業收入-去年同月增減(%)") or 0) / 100
        except ValueError:
            continue
        history.setdefault(ticker, {})[month] = {
            "revenue_ntd_thousand": rev_ntd_thousand,
            "yoy": yoy,
        }

    DATA.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False))

    out = []
    for ticker in TARGETS.values():
        months = sorted(history.get(ticker, {}).keys())[-13:]
        out.append({
            "ticker": ticker,
            "months": months,
            "revenue_ntd_thousand": [history[ticker][m]["revenue_ntd_thousand"] for m in months],
            "yoy": [history[ticker][m]["yoy"] for m in months],
        })
    return out
