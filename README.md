# Binder

複数のリンクをフォルダーに整理し、URLで渡す、アカウント不要の一時共有サービス。作成から**168時間（604,800,000ms）**でアクセスできなくなります。編集しても延長されません。

## ローカル起動

Node.js **22.12以上**、npmが必要です。Node.js 26で検証しています。

```sh
npm ci
npm run db:migrate
npm run dev
```

**http://localhost:8787** を開いて `Create Binder`。表示された編集画面で `Copy Edit URL` を押し、URLを保管してください。復元はできません。`Copy Share URL` は閲覧専用です。

- フォルダー名を押すと開き、パンくずで戻ります。
- 編集画面で項目のラジオボタンを選び、`Rename` / `Move` / `Delete` を操作します。
- リンクのURLは `Rename` のフォームで変更できます。
- `Move up` / `Move down` で同じ階層内の順序を保存します。
- フォームはその場に表示されます。削除には確認操作が必要です。
- Tab / Shift+Tab、Enter / Space、ラジオボタンの矢印キー、フォーム内のEscapeを使えます。
- ThemeはSystemが初期値です。Light / Darkも選べ、テーマのみlocalStorageへ保存します。

`npm run dev` はViteでビルド後、WranglerのローカルWorkerからフロントエンドとAPIを同一オリジンで配信します。フロントエンド変更後は別ターミナルで `npm run build` を実行し、ブラウザーを再読み込みしてください。Workerの変更はWranglerが検知します。

ローカルD1は `.wrangler/state/` に永続化されます。クラウドのDBは使用しません。`.wrangler/` の削除はローカルデータの消去になるため、通常のセットアップでは不要です。

## 構成

```text
src/
  worker.ts                   Hono API、認証、Cron
  types.ts                    API / UI共通のデータ型
web/
  index.html                  ページの共通シェル
  main.ts                     Vanilla TypeScriptのファイルマネージャー
  style.css                   レスポンシブ、System / Light / Dark
  public/_headers             Static Assetsのセキュリティヘッダー
migrations/
  0001_initial.sql            テーブル、インデックス、整合性トリガー
  0002_require_link_url.sql   SQLiteのNULL評価を補う制約
tests/
  setup.ts                    ローカルD1のマイグレーション適用
  api.test.ts                 実D1 / workerdでの統合テスト
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

初期実装の検証結果：

- **20テスト成功**：作成、3階層Folder、Link作成・編集、移動、循環 / 異なるBinder / Link親の拒否、Node・配下一括・Binder削除、全更新APIのトークン検証、他Binderのトークン拒否、並び替え・不正な集合の拒否、期限直前 / ちょうど期限、期限後の各更新拒否、処理中の期限超過、Cron、期限不変、不正URL7パターン、入力制限、同時作成での上限検証など。
- TypeScript・Viteビルド・Wrangler dry-run成功。
- `npm audit`：開発依存を含め **0 vulnerabilities**（実行時点）。
- 既存Chromeでブラウザーフロー成功。作成、入れ子、XSS文字列のテキスト表示、名前 / URL編集、実際のClipboard内容、閲覧専用UI、無効トークン、移動、並べ替え、削除、保存失敗時の入力保持、保存後の再取得失敗とRetry、テーマ追従・永続化を確認。
- 390×844 / 1280×800で画面確認。390px幅で横方向のオーバーフローなし。
- ローカルDBの**検証専用Binder**を15秒後の期限に設定し、実時間で一覧非表示とAPI 404を確認。Cronを呼び、対象行が0件になることを確認。

### ブラウザーフローの再実行

`npm run dev` を別ターミナルで起動し、インストール済みPlaywright CLIとChromeを使用します。ブラウザーのダウンロードは不要です。PiのPlaywrightがある環境では以下で実行できます。

```sh
PW="$HOME/.pi/agent/npm/node_modules/pi-playwright/skills/playwright-browser/scripts/pw.js"
node "$PW" open http://localhost:8787 --browser=chrome
node "$PW" run-code "$(node --input-type=module -e 'import { run } from "./tests/browser.mjs"; process.stdout.write(run.toString());')"
node "$PW" close
```

通常の `playwright-cli` がある場合は、`node "$PW"` 部分を `playwright-cli` に置き換えてください。`tests/browser.mjs` はテスト用Binderを新規作成し、最後にそのBinderを削除します。スクリーンショットは `/tmp/binder-mobile.png` と `/tmp/binder-desktop.png` です。テスト中の想定内401 / 404 / 503はブラウザーコンソールに記録されることがありますが、未処理JavaScript例外はありません。

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
