# Binder

複数のリンクをフォルダーに整理し、URLで渡す、アカウント不要の一時共有サービス。作成から**168時間（604,800,000ms）**でアクセスできなくなります。編集しても延長されません。

## ローカル起動

Node.js **22.12以上**、npmが必要です。Node.js 26で検証しています。

```sh
npm ci
npm run db:migrate
npm run dev
```

**http://localhost:8787** を開いて `Binderを作成`。タイトル横の **共有は閲覧用URLだけ**をコピーします。編集用URLはその他メニュー（`Binderのその他の操作`）の `編集用URLをコピー` からコピーして保管してください。復元はできません。

画面は日本語表示です。操作・読み上げ用ラベル・入力検証・APIエラー・通信エラーも日本語で案内します。APIのレスポンス形式と英語エラーメッセージ自体は変更せず、フロントエンドで翻訳します。未知のエラー本文はそのまま表示せず、日本語の案内に置き換えます。日時は日本語表記で、タイムゾーンは利用端末の設定に従います。言語切り替え機能は追加していません。日本語変換中のEnterで保存せず、Escapeで編集欄を閉じないようにしています。

- URLを入力欄に貼り付けてEnter。ホスト名を初期タイトルとして追加し、入力欄が空になったら続けて追加できます。外部メタデータは取得しません。
- `新しいフォルダー` は一覧内に名前入力行を作ります。Enterで保存、Escapeでキャンセル。既存フォルダーの `名前を変更` も同じ行内入力です。
- フォルダー名を押すと開き、パンくずで戻ります。ブラウザーの戻る・進むにも対応します。
- 各行のその他メニューから `名前を変更` / `編集`（リンクのみ）/ `移動` / `削除` を選びます。右クリック、Shift+F10、コンテキストメニューキーでも同じメニューを開けます。タッチ用ボタンは常時表示します。
- リンクの `名前を変更` は名前のみ、`編集` は名前とURLを編集します。`移動` は同じ行で移動先を選択します。
- 項目メニューの `上へ移動` / `下へ移動` で順序を保存します。ドラッグは不要で、タッチ・キーボードでも並べ替えできます。
- メニューは上下矢印・Home・Endで移動し、Escapeで閉じます。行内フォームもEscapeでキャンセルできます。
- 残り時間はタイトル横に表示し、押すと削除予定日時が分かります。`Binderを削除` はその他メニュー内にあり、項目削除・Binder削除とも確認が必要です。
- 保存中は操作を無効化し、失敗時は入力を保持します。フィードバックは操作場所の近くに表示し、成功表示は約3.5秒で消えます。
- テーマは `端末に合わせる` が初期値です。`ライト` / `ダーク` も選べ、テーマのみlocalStorageへ保存します。既存のテーマ設定はそのまま引き継ぎます。

閲覧・編集で共通の一覧とナビゲーションを使い、閲覧画面では作成・編集・削除操作を表示しません。Folder移動で再構築するのはパンくずと一覧だけで、タイトルやURL入力欄のDOMは保持します。保存後はAPIの応答を一覧へ反映し、全画面の再取得は行いません。API・D1スキーマ・認証・168時間の有効期限・CronはUI再設計前から変更していません。

`npm run dev` はViteでビルド後、WranglerのローカルWorkerからフロントエンドとAPIを同一オリジンで配信します。フロントエンド変更後は別ターミナルで `npm run build` を実行し、ブラウザーを再読み込みしてください。Workerの変更はWranglerが検知します。

ローカルD1は `.wrangler/state/` に永続化されます。クラウドのDBは使用しません。`.wrangler/` の削除はローカルデータの消去になるため、通常のセットアップでは不要です。

## 構成

```text
src/
  worker.ts                   Hono API、認証、Cron
  types.ts                    API / UI共通のデータ型
web/
  index.html                  ページの共通シェル
  main.ts                     ファイルマネージャーの状態・行内編集・部分更新
  ui.ts                       共通DOM、日本語入力検証・IME配慮、SVG・メニュー
  locale.ts                   APIエラーの日本語化・残り時間の表記
  style.css                   レスポンシブ、System / Light / Dark
  public/_headers             Static Assetsのセキュリティヘッダー
migrations/
  0001_initial.sql            テーブル、インデックス、整合性トリガー
  0002_require_link_url.sql   SQLiteのNULL評価を補う制約
tests/
  setup.ts                    ローカルD1のマイグレーション適用
  api.test.ts                 実D1 / workerdでの統合テスト
  locale.test.ts              日本語エラー・残り時間の境界テスト
  browser.mjs                 Playwright CLI用ブラウザーフロー
vite.config.ts
vitest.config.ts
wrangler.jsonc
```

Hono以外の実行時依存はありません。React、認証サービス、外部フォント、画像、解析SDKは使用していません。`package-lock.json`をコミットし、開発ツールの間接依存undici / zodは修正版の互換メジャーへoverrideしています。

## DBスキーマ

時刻はすべてUTC Unix epochミリ秒です。

| テーブル | カラム |
| --- | --- |
| `binders` | `id` PK、`title`、`edit_token_hash`、`created_at`、`expires_at`、`updated_at` |
| `nodes` | `id` PK、`binder_id` FK、`parent_id` nullable FK、`type`、`title`、`url` nullable、`sort_order`、`created_at`、`updated_at` |

- `expires_at = created_at + 604800000` をCHECK制約で固定。
- Binder IDは128bit、編集トークンは256bitの暗号学的乱数（hex表現）。DBにはSHA-256ハッシュのみ保存。
- `parent_id = NULL` がルート。親は同一Binder内のFolderに限定。
- Binderの入れ子、Linkを親にする操作、自分自身・子孫への移動を禁止。
- 再帰CTEを使うDBトリガーが循環を拒否。並行リクエストでも検証と更新の間に隙間を作りません。
- Binder / Folder削除は外部キーの `ON DELETE CASCADE`。単一SQL文で配下まで削除します。
- 順序は `sort_order, id`。新規作成・移動時は移動先の末尾へ追加。
- 並べ替えは同じ階層の全IDを1回ずつ渡し、単一SQL文で集合を検証・更新します。並行編集で集合が変わっていれば409です。
- Node更新トリガーはBinderの `updated_at` だけを変更し、期限には触れません。
- インデックス：Binderの期限 / 作成時刻、NodeのBinder・親・順序・ID、親ID単独（カスケード用）。
- ローカル・本番とも同じマイグレーションを使います。Wrangler管理用の `d1_migrations` テーブルは自動作成されます。

### マイグレーション

```sh
# ローカルのみ。未適用のものだけを適用
npm run db:migrate

# 状態確認（ローカル）
npx wrangler d1 migrations list binder --local
```

既存テーブルをDROPするマイグレーションはありません。新しい変更は番号付きSQLを追加してください。

## API

| メソッド | パス | 内容 | 認証 |
| --- | --- | --- | --- |
| POST | `/api/binders` | 作成。任意の `title` | 不要 |
| GET | `/api/binders/:id` | Binderと全Node取得 | 不要 |
| GET | `/api/binders/:id/access` | 編集権限の確認 | 必要 |
| DELETE | `/api/binders/:id` | Binder全削除 | 必要 |
| POST | `/api/binders/:id/nodes` | Folder / Link作成 | 必要 |
| PATCH | `/api/binders/:id/nodes/:nodeId` | 名前 / URL / 親を変更 | 必要 |
| DELETE | `/api/binders/:id/nodes/:nodeId` | Nodeと配下を削除 | 必要 |
| PUT | `/api/binders/:id/reorder` | 同一階層の並び替え | 必要 |

```jsonc
// POST /api/binders/:id/nodes
{"type":"folder","title":"Research","parent_id":null}

// Linkにはurlが必要。Folderにはurlを指定できない
{"type":"link","title":"Documentation","url":"https://example.com/","parent_id":null}

// PATCH /api/binders/:id/nodes/:nodeId（指定した項目のみ更新）
{"title":"Sources","parent_id":null}

// PUT /api/binders/:id/reorder（全兄弟のIDを順番通りに指定）
{"parent_id":null,"ids":["NODE_ID_2","NODE_ID_1"]}
```

JSONのリクエストには `Content-Type: application/json`、編集リクエストには `Authorization: Bearer SECRET_TOKEN` を送ります。編集URLは `/b/ID/edit#SECRET_TOKEN`。フラグメントはHTTPリクエストやRefererには含まれません。トークンは作成時に1回だけJSONで返し、閲覧APIにはハッシュもトークンも返しません。

主なレスポンス：作成201、取得・更新200、削除204、不正入力400、認証エラー401、存在しない・期限切れ404、集合の競合・項目上限409、サイズ超過413、Content-Type違い415、作成上限429。予期しないDBエラーは内部情報を出さず500です。

### 有効期限とCron

期限の判定は **`now >= expires_at` でアクセス禁止**。GET時はデータ取得後にも検査します。Node作成・更新はDB実行時にも期限を検査し、削除SQLもDB実行時の時計で確認します。閲覧・編集APIの期限拒否はCronの実行を待ちません。

Cronは15分ごと、1回最大10 Binderを期限順に物理削除します。大量のカスケード削除を1回に集中させないための制限です。障害や大量データで未削除の期限切れデータが残ってもアクセスは禁止されます。物理削除の完了時刻は7日ぴったりではありません。

Cloudflareのバックアップ / Time Travelの保持期間はアプリ側の削除と別です。「物理削除」は稼働中DBからの削除を指し、プラットフォームのバックアップから即座に消去する保証ではありません。

## テストと検証

```sh
npm run check       # TypeScript（Worker / UI / tests）、Vitest、Vite build
npm test
npm audit
npx wrangler deploy --dry-run --outdir /tmp/binder-worker-dryrun
```

VitestはCloudflare公式プラグインで**ローカルworkerdとD1**を動かし、実マイグレーションを適用します。DBのモックは使いません。各テスト前の消去は独立したテストDBだけが対象で、開発用 `.wrangler/state/` には触れません。

日本語対応後の検証結果：

- **40テスト成功**（D1統合20件、日本語表示20件）。D1統合テスト：作成、3階層Folder、Link作成・編集、移動、循環 / 異なるBinder / Link親の拒否、Node・配下一括・Binder削除、全更新APIのトークン検証、他Binderのトークン拒否、並び替え・不正な集合の拒否、期限直前 / ちょうど期限、期限後の各更新拒否、処理中の期限超過、Cron、期限不変、不正URL7パターン、入力制限、同時作成での上限検証など。
- TypeScript・Viteビルド成功。バックエンド・依存パッケージの変更なし。
- `npm audit`：開発依存を含め **0 vulnerabilities**（実行時点）。
- 既存Chromeでブラウザーフロー成功。URLだけでの連続追加、3階層Folder、行内作成・Rename、名前 / URL編集、移動、上下並べ替え、確認付き削除、XSS文字列のテキスト表示を確認。
- 右クリック、Shift+F10、矢印・End・Escapeによるメニュー操作、戻る・進む、ナビゲーション中のヘッダー・URL入力DOM保持を検証。
- フォルダー作成・名前変更の503応答、URL追加の通信失敗で日本語エラーが表示され、入力を保持して再試行できることを確認。必須入力・URL形式のブラウザー検証も日本語表示です。合成キーイベントでIME変換中のEnter / Escapeが保存・編集キャンセルに流れないことも確認しています（OSの実IME操作は未検証）。無効URL・無効トークン、閲覧専用UIも検証。
- 実際のClipboard内容が `共有` では閲覧URL、明示的な編集URLコピーでは編集URLになることを確認。Clipboard失敗時も編集トークンをDOMへ描画しません。
- 375×812 / 1280×800で、トップ・空状態・複数項目・多階層・Light / Darkを画面確認。375pxの編集フォーム・長い日本語名でも横方向のオーバーフローなし。長い日本語エラーがナビゲーションに重ならないこと、テーマ追従・永続化を確認。
- UI編集の前後で `expires_at` が不変であることと、ブラウザー時計を進めたとき期限後の一覧が消えることを検証。実D1でのAPI期限拒否・Cron削除は20件の統合テストに含まれます。
- 配色の計算値：補助文字はLightで5.57:1、Darkで7.99:1。入力境界はそれぞれ3.11:1、3.29:1。

### ブラウザーフローの再実行

`npm run dev` を別ターミナルで起動し、インストール済みPlaywright CLIとChromeを使用します。ブラウザーのダウンロードは不要です。PiのPlaywrightがある環境では以下で実行できます。

```sh
PW="$HOME/.pi/agent/npm/node_modules/pi-playwright/skills/playwright-browser/scripts/pw.js"
node "$PW" open http://localhost:8787 --browser=chrome
node "$PW" run-code "$(node --input-type=module -e 'import { run } from "./tests/browser.mjs"; process.stdout.write(run.toString());')"
node "$PW" close
```

通常の `playwright-cli` がある場合は、`node "$PW"` 部分を `playwright-cli` に置き換えてください。`tests/browser.mjs` はテスト用Binderを新規作成し、最後にそのBinderを削除します。スクリーンショットは `/tmp/binder-ja-*.png`（home / empty / desktop / nested / mobile / mobile-menu / mobile-edit / mobile-error）です。項目メニューは標準のPopover APIを使用するため、現行のChrome / Safari / Firefox等を対象とします。テスト中の想定内401 / 404 / 503はブラウザーコンソールに記録されることがありますが、未処理JavaScript例外はありません。

### 期限切れを手元で確認

**自分で作った検証用Binderだけ**に実行してください。以下はローカルDBの該当Binderを期限切れにする管理操作です。本番APIに期限変更機能はありません。

```sh
ID='検証用Binderの32桁ID'
NOW=$(node -p 'Date.now() - 1')
npx wrangler d1 execute binder --local --command \
  "UPDATE binders SET created_at = $((NOW - 604800000)), expires_at = $NOW WHERE id = '$ID'"
```

閲覧・編集URLを再読み込みするとアクセスできません。APIも404を返します。15秒後の画面変化を見たい場合は、`NOW` の式を `Date.now() + 15000` にして、削除前にページを開いてください。

```sh
# ローカルCronを手動実行（期限切れのローカルBinderを最大10件削除）
curl 'http://localhost:8787/cdn-cgi/local/scheduled?format=json'
# 成功時 {"outcome":"ok","noRetry":false}
```

## セキュリティと無料枠

### 実装済みの境界

- アカウント、メール、IP、アクセス履歴をDBに収集しません。Worker側でリクエスト・トークン・入力内容をログ出力しません。Observabilityは無効です。ただしCloudflare等のプラットフォーム自身によるログ保存まで制御するものではありません。
- 編集URLはBearer権限です。URLを知る全員が変更・全削除できます。ブラウザー履歴、拡張機能、クリップボード、画面共有からの漏えいに注意してください。トークン回復・ローテーションはありません。
- 閲覧URLも秘密文書向けの認証ではありません。URLを知る誰でも閲覧できます。機密情報を置かないでください。
- 入力をHTMLとして挿入せず `textContent` を使用。CSP、frame-ancestors、nosniff、no-referrer、Permissions-Policy、noindex、no-storeをAPIとStatic Assetsへ設定。
- SQLの値はすべてバインド。動的なSET句はコード内の固定カラム名のみです。
- URLはhttp / https限定。資格情報を含むURLや制御文字を拒否。外部リンクは `target="_blank" rel="noopener noreferrer"`。リンク先への自動アクセス・OGP取得は行いません。
- 他オリジンからの更新を拒否。Cookie認証やCORS許可は使いません。
- 名前200文字、URL 2,048文字、JSONリクエスト16KiB、1 Binder 200 Node。FolderもNodeとして数えます。最大階層数もNode上限によって制限されます。
- DBトリガーで、保持中データのうち直近1時間の作成数20件、全体2,000 Binderを上限とし、同時作成も制限。**これはサービス全体の初期運用制限**です。

### 限界と公開前の推奨

上限は本格的なbot対策ではありません。攻撃者が作成枠を占有すれば正規ユーザーも作成できなくなり、作成後すぐ削除するbotは保持行ベースの作成制限を迂回できます。閲覧連打や不正トークンのリクエストだけでもWorkers / D1の無料枠を消費します。

公開前に、無料の**Cloudflare TurnstileをBinder作成に適用**し、サーバー側で検証することを推奨します。専用ドメインがあればFreeプランで使えるWAFルール等も検討してください。これらは未設定で、既存アカウント資源を勝手に作成・変更していません。必要なら将来、個人を追跡しない時間帯別の作成カウンターとサービス停止スイッチを追加します。

公式資料確認時点（2026-10-26）：

| 項目 | Freeの上限 |
| --- | --- |
| Workers動的リクエスト | 100,000 / 日（アカウント内で共有） |
| Workers CPU | 10ms / 呼び出し |
| D1 rows read | 5,000,000 / 日 |
| D1 rows written | 100,000 / 日 |
| D1ストレージ | アカウント合計5GB、1 DB最大500MB |

インデックス・トリガー・カスケード削除も読み書きを消費します。アプリの件数上限だけで500MBや日次枠内を保証するものではありません。無料枠超過時は失敗・停止し得ます。有料プランへの自動変更や課金設定は行いません。実クラウドでのCPU・負荷・料金測定は未実施です。

## Cloudflareへのデプロイ（許可後のみ）

**この実装では本番デプロイ、クラウドD1作成、既存資源変更、Git pushは実行していません。** 設定のDB IDはローカル用のゼロUUIDです。そのまま本番には使えません。

現在の環境では `cf auth whoami` と `npx wrangler whoami` で既存OAuth認証が有効でした。不要な再ログインは行っていません。

公開を許可した後、アカウントがWorkers Freeであること、既存の同名Worker / D1 / Cronと衝突しないことを確認し、**新規専用資源**に対して次を実行してください。

```sh
# 読み取りだけ。トークンをコピーしたりREADMEに貼り付けたりしない
cf auth whoami
npx wrangler whoami

# ここからクラウドへの変更。明示的な許可を得てから実行
npx wrangler d1 create binder
```

返された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に設定します。既存資源と同名なら、専用名を選んで `name` / `database_name` と以下コマンドも対応させてください。DB IDは認証秘密ではありません。APIトークン・OAuth情報はコミットしません。

```sh
npx wrangler d1 migrations apply binder --remote
npm run check
npx wrangler deploy --dry-run
npx wrangler deploy
```

最後のコマンドはWorker、Static Assets、設定内のCronを公開します。Cronの反映には最大15分程度かかる場合があります。同一Workerのドメインで `/`、`/b/...`、`/api/...` が利用できます。Cronと静的アセットの設定はWranglerに一本化しています。cfによる別構成への自動変換はしません。

### 未実装・対象外

- ファイルアップロード、アカウント、ログイン、Binderの入れ子、期限延長、編集URL復元（要件通り提供しません）。
- ドラッグ＆ドロップ、複数項目選択、Undo、リアルタイム共同編集、履歴・バックアップ復元のUI。
- Turnstile / WAFの導入、完全なbot対策、実クラウドでの負荷試験、正式な独立セキュリティ監査。
- 実端末のSafari / Firefox、スクリーンリーダーでの検証。キーボード操作とアクセシブルなHTMLは実装していますが、WCAG適合を保証するものではありません。

## 参照した公式資料

- [D1の開始・ローカル開発](https://developers.cloudflare.com/d1/get-started/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 binding / batchのトランザクション](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [WorkerとStatic Assetsのルーティング](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Cron Triggersとローカル実行](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
