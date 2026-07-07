# ローカルダッシュボードサーバー。
# 起動時にスナップショットが12時間より古ければバックグラウンドで自動更新する。
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .fetcher import SNAPSHOT, build_snapshot

BASE = Path(__file__).resolve().parent
STALE_HOURS = 12

app = FastAPI(title="AI Capex Monitor")

_state = {"fetching": False, "progress": "", "error": None}
_lock = threading.Lock()


@app.middleware("http")
async def no_cache(request, call_next):
    # 個人用ローカルツールなのでキャッシュより「常に最新のコードを見せる」を優先する。
    # ヘッダー無指定だとブラウザが静的ファイルをヒューリスティックにキャッシュし、
    # 更新後の再読み込みで古いCSS/JSが残ることがあるため明示的に無効化する。
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


def _snapshot_age_hours():
    if not SNAPSHOT.exists():
        return None
    try:
        data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        ts = datetime.fromisoformat(data["generated_at"])
        return (datetime.now(timezone.utc) - ts).total_seconds() / 3600
    except Exception:
        return None


def _run_fetch():
    try:
        build_snapshot(progress=lambda m: _state.update(progress=m))
        _state["error"] = None
    except Exception as e:
        _state["error"] = f"{type(e).__name__}: {e}"
    finally:
        _state["fetching"] = False


def start_fetch():
    with _lock:
        if _state["fetching"]:
            return False
        _state["fetching"] = True
        _state["progress"] = "開始中..."
    threading.Thread(target=_run_fetch, daemon=True).start()
    return True


@app.on_event("startup")
def maybe_refresh():
    age = _snapshot_age_hours()
    if age is None or age > STALE_HOURS:
        start_fetch()


@app.get("/api/snapshot")
def get_snapshot():
    if not SNAPSHOT.exists():
        return JSONResponse({"ready": False}, status_code=404)
    return FileResponse(SNAPSHOT, media_type="application/json")


@app.post("/api/refresh")
def refresh():
    started = start_fetch()
    return {"started": started, **_state}


@app.get("/api/status")
def status():
    age = _snapshot_age_hours()
    return {**_state, "snapshot_age_hours": age, "ready": SNAPSHOT.exists()}


app.mount("/", StaticFiles(directory=BASE / "static", html=True), name="static")
