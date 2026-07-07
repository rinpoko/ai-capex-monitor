# AI・半導体 マネーフロー・モニター

AI・半導体・データセンター業界の「資金がどこに流れているか」を毎日チェックするためのローカルダッシュボード。
株式投資のためのファンダメンタルズ集約ツールです。

## 何が見えるか

- **3Dマネーフロー・ファネル（ヒーロー）** — 開いて最初に目に入る、資金の流れを表す立体ファネル。ハイパースケーラー（資金源）→ 電力・DC・サーバー → 光通信 → 電線・銅 → GPU → メモリ → ファウンドリ → 製造装置の順に、段の太さ＝資金集中度（ヒート）、緑の▲＝資金流入中（CAPEX拡大）、下降する光の粒＝実際のCAPEX額（USD換算）に比例した速さ・太さ・輝きで表現。ゆっくり回転しながら真横寄りの角度で表示。クリックで絞り込み
- **セクターヒートマップ** — 8セクター（ハイパースケーラー / GPU / ファウンドリ / メモリ・ストレージ / 製造装置 / 電力・冷却・サーバー / 光通信 / 電線・銅）ごとのヒートスコア。
  ヒート = CAPEX前年比 40% + 株価1ヶ月モメンタム 40% + 直近7日ニュース量 20%
- **ハイパースケーラー四半期CAPEX積み上げチャート** — MSFT / GOOGL / AMZN / META / ORCL の設備投資推移（AIインフラ投資の総量）
- **TSMC/UMC 月次売上YoYチャート** — 台湾TWSEの月次開示。四半期決算より先行する景況インジケーター
- **企業ファンダメンタルズ表** — 49社（主力＋2軍）の時価総額・株価リターン・CAPEX YoY・売上 YoY・R&D YoY・CAPEX/売上・SNS話題度。列クリックでソート、セクターカードクリックで絞り込み。データ出典タグ（SEC/Yahoo/年次）付き
- **関連ニュース・開示情報** — 日英16クエリのGoogle News + EDINET開示情報（設定時）をセクター・企業に自動タグ付けして集約

## 使い方

```sh
./start.sh          # サーバー起動 + ブラウザで http://127.0.0.1:8765 を開く
```

- 起動時にデータが**12時間より古ければ自動で再取得**します（1〜2分）。毎日開くだけで最新化されます。
- 手動更新は画面右上の「データ更新」ボタン。
- 日次スナップショットは `data/history/YYYY-MM-DD.json` に蓄積されます（将来のトレンド分析用）。

## データソース

| データ | ソース | 備考 | APIキー |
|---|---|---|---|
| 米国企業のCAPEX・売上・R&D（一次情報） | [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) (XBRL) | 提出書類の原本データ。累計開示から単四半期値を復元。31/49社が対象 | 不要 |
| その他企業のCAPEX・売上・R&D・株価 | Yahoo Finance (yfinance) | 日本企業等は四半期開示が無いため年次にフォールバック | 不要 |
| ニュース記事 | Google News RSS | 日本語8クエリ + 英語8クエリ | 不要 |
| 日本企業の開示情報 | [EDINET](https://disclosure2.edinet-fsa.go.jp/) API v2 | 有価証券報告書等の提出をニュース欄に自動掲載。**任意機能** | 要（無料登録） |
| SNSセンチメント（Reddit） | Reddit公開JSON (r/semiconductors等) | 直近7日の企業言及数。データセンターIPからブロックされる場合あり | 不要 |
| SNSセンチメント（StockTwits） | StockTwits公開API | 米国ティッカーのブル/ベア比率 | 不要 |
| TSMC/UMC月次売上 | [台湾証券取引所 OpenAPI](https://openapi.twse.com.tw/) | 決算より速い先行指標。毎日の実行ごとに履歴を蓄積 | 不要 |

moomoo APIは常駐ゲートウェイ（OpenD）とアカウントログイン維持が必要な割に、CAPEX等のファンダメンタルズでは強みが薄いため見送りました。

### EDINET連携を有効にする（任意）

1. https://api.edinet-fsa.go.jp/api/auth/index.aspx?mode=1 で無料登録（電話番号認証、ポップアップ許可が必要）
2. 発行されたSubscription Keyを環境変数に設定してから起動:
   ```sh
   export EDINET_API_KEY="取得したキー"
   ./start.sh
   ```

## Mac用アプリ

Electronでネイティブランチャー化してあります（`.venv`をこの場所からそのまま起動するだけの薄いラッパーなので、`app/`以下を更新しても再ビルド不要で反映されます）。

```sh
npm install          # 初回のみ
npm start            # 開発時: Electronで直接起動して確認
npm run dist          # dist/ に .app と .dmg を生成（Apple Developer署名はしていないため初回起動時に右クリック→開くが必要）
```

生成物: `dist/mac-arm64/AI Capex Monitor.app`、`dist/AI Capex Monitor-1.0.0-arm64.dmg`

## iPhone（PWA）対応

ネイティブiOSアプリのビルドにはXcode・Apple Developerアカウントが必要でこの環境では作成できないため、**PWA（Progressive Web App）**として移植しました。iPhoneのSafariで開き、共有ボタン→「ホーム画面に追加」でアプリのように起動できます（アイコン・スタンダアロン表示・ノッチ対応済み）。

- ファネルはスマホ幅（640px未満）で専用レイアウトに切り替わり、ラベルが各リングの真下に中央寄せで表示されます
- テーブルは横スクロール、セクターカード・ニュースは縦積みに自動対応

Macで起動したサーバーに、同じWi-Fi内のiPhoneから `http://<MacのIPアドレス>:8765` でアクセスできます。

## カスタマイズ

- 監視銘柄・セクターの追加: [app/companies.py](app/companies.py) の `COMPANIES`
- ニュース検索クエリ: 同ファイルの `NEWS_QUERIES`
- 自動更新の閾値: [app/server.py](app/server.py) の `STALE_HOURS`
- SEC EDGARの連絡先メール: [app/edgar.py](app/edgar.py) の `CONTACT_EMAIL`（SECのポリシー上、実際の連絡先を推奨）
- ファネルの並び順・演出: [app/static/app.js](app/static/app.js) の `FUNNEL_FLOW` / `Funnel` オブジェクト

## 注意

- SEC EDGARが利用できる米国企業はEDGARの一次データを優先採用し、それ以外はYahoo Financeにフォールバックします（企業テーブルの出典タグで確認可能）。
- 決算期が暦四半期とずれる企業（NVDA, AVGO, ORCL等）は暦四半期に丸めて比較しています。
- Redditはネットワーク環境によっては403でブロックされ、その場合SNS話題度にReddit分は出ません（StockTwitsは通常通り動作）。
- 投資判断は自己責任で。
