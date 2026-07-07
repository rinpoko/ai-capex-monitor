# SEC EDGAR (data.sec.gov) — 米国上場企業の一次情報（XBRL原本）による
# CAPEX/R&D/売上のクロス検証・高精度化。無料・APIキー不要。
# 10-QのCAPEX等は米国会計基準上つねに「期首からの累計」で開示されるため、
# 隣接期間の差分を取って単四半期の値を復元する。
import json
import re
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
CIK_CACHE = DATA / "edgar_cik_map.json"
CONTACT_EMAIL = "mail@rinshiro.com"
UA = f"ai-capex-monitor/1.0 ({CONTACT_EMAIL})"

CAPEX_TAGS = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
]
RD_TAGS = ["ResearchAndDevelopmentExpense"]
REV_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def _load_cik_map():
    if CIK_CACHE.exists():
        age_days = (time.time() - CIK_CACHE.stat().st_mtime) / 86400
        if age_days < 30:
            return json.loads(CIK_CACHE.read_text())
    data = _get("https://www.sec.gov/files/company_tickers.json")
    m = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in data.values()}
    DATA.mkdir(parents=True, exist_ok=True)
    CIK_CACHE.write_text(json.dumps(m))
    return m


_CIK_MAP = None


def get_cik(ticker):
    global _CIK_MAP
    if "." in ticker:  # 東証・韓国取引所などSEC非対象
        return None
    if _CIK_MAP is None:
        try:
            _CIK_MAP = _load_cik_map()
        except Exception:
            _CIK_MAP = {}
    return _CIK_MAP.get(ticker)


def _fetch_concept(cik, tag):
    try:
        d = _get(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json")
    except Exception:
        return []
    usd = d.get("units", {}).get("USD", [])
    return [f for f in usd if f.get("form") in ("10-Q", "10-K")]


def _merge_tags(cik, tags):
    """企業がXBRLタグを乗り換えているケース（例: NVDAは2021年前後にCAPEXタグを変更）
    に対応するため、候補タグ全てのファクトを合算する。"""
    merged = []
    for tag in tags:
        merged.extend(_fetch_concept(cik, tag))
    return merged


def _reconstruct_discrete(facts):
    """累計値から単四半期値を復元する。3ヶ月分がそのまま開示されていればそれを優先し、
    無ければ同一会計年度内の累計値の差分を取る。"""
    dedup = {}
    for f in facts:
        key = (f["start"], f["end"])
        if key not in dedup or f.get("filed", "") > dedup[key].get("filed", ""):
            dedup[key] = f

    direct = {}   # end -> val （3ヶ月そのままの開示）
    cum_groups = {}  # start -> [facts] （累計開示）
    for f in dedup.values():
        try:
            span = (date.fromisoformat(f["end"]) - date.fromisoformat(f["start"])).days
        except ValueError:
            continue
        if 80 <= span <= 100:
            direct[f["end"]] = f["val"]
        elif span > 100:
            cum_groups.setdefault(f["start"], []).append(f)

    discrete = dict(direct)
    for start, items in cum_groups.items():
        items.sort(key=lambda x: x["end"])
        prev_val = 0
        for it in items:
            end = it["end"]
            if end not in discrete:
                discrete[end] = it["val"] - prev_val
            prev_val = it["val"]
    return discrete  # {"YYYY-MM-DD": value}


def _to_quarter_key(end_iso):
    y, m, _ = end_iso.split("-")
    q = (int(m) - 1) // 3 + 1
    return f"{y}Q{q}"


def _yoy(series):
    keys = sorted(series.keys())
    for k in reversed(keys):
        y = int(k[:4])
        prev = f"{y - 1}{k[4:]}"
        if prev in series and series[prev]:
            base = abs(series[prev])
            if base > 0:
                return (abs(series[k]) - base) / base
    return None


def fetch_company_edgar(ticker):
    """成功時 {quarters, capex_yoy, rev_yoy, rd_yoy, source} / データ無しなら None。"""
    cik = get_cik(ticker)
    if not cik:
        return None
    try:
        capex_raw = _merge_tags(cik, CAPEX_TAGS)
        rev_raw = _merge_tags(cik, REV_TAGS)
        rd_raw = _merge_tags(cik, RD_TAGS)
    except Exception:
        return None
    if not capex_raw and not rev_raw:
        return None  # 外国民間発行体（20-F提出）など四半期XBRLが無い企業

    def series(raw):
        d = _reconstruct_discrete(raw)
        out = {}
        for end, val in d.items():
            out[_to_quarter_key(end)] = out.get(_to_quarter_key(end), 0) + abs(val)
        return out

    capex = series(capex_raw)
    rev = series(rev_raw)
    rd = series(rd_raw)
    keys = sorted(set(capex) | set(rev) | set(rd))[-9:]
    return {
        "source": "SEC EDGAR",
        "quarters": [
            {"q": k, "capex": capex.get(k), "rev": rev.get(k), "rd": rd.get(k)}
            for k in keys
        ],
        "capex_yoy": _yoy(capex),
        "rev_yoy": _yoy(rev),
        "rd_yoy": _yoy(rd),
    }
