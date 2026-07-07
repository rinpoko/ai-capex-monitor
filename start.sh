#!/bin/zsh
# AI Capex Monitor を起動してブラウザを開く
# --host 0.0.0.0 で同じWi-Fi内の他端末（iPhone等）からもアクセス可能にする
cd "$(dirname "$0")"
open "http://127.0.0.1:8765" 2>/dev/null &
exec .venv/bin/python -m uvicorn app.server:app --app-dir "$(pwd)" --host 0.0.0.0 --port 8765
