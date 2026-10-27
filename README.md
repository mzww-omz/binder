# Binder

複数のリンクをフォルダーに整理し、URLで渡す、アカウント不要の一時共有サービス。作成から**168時間（604,800,000ms）**でアクセスできなくなります。編集しても延長されません。

## ローカル起動

Node.js **22.12以上**、npmが必要です。Node.js 26で検証しています。

```sh
npm ci

# ローカル用のHMAC鍵を生成（値を表示せず、既存の鍵は上書きしない）
node --input-type=module <<'JS'
import { existsSync, readFileSync, appendFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = '.dev.vars';
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
if (!/^\s*(?:export\s+)?IP_RATE_LIMIT_SECRET\s*=/m.test(current)) {
  appendFileSync(file, `\nIP_RATE_LIMIT_SECRET="${randomBytes(32).toString('hex')}"\n`, { mode: 0o600 });
}
chmodSync(file, 0o600);
JS

npm run db:migrate
npm run dev
```

**http://localhost:8787** を開いて `Binderを作成`。タイトル横の **共有は閲覧用URLだけ**をコピーします。編集用URLはその他メニュー（`Binderのその他の操作`）の `編集用URLをコピー` からコピーして保管してください。復元はできません。

画面は日本語表示です。操作・読み上げ用ラベル・入力検証・APIエラー・通信エラーも日本語で案内します。APIのレスポンス形式と英語エラーメッセージ自体は変更せず、フロントエンドで翻訳します。未知のエラー本文はそのまま表示せず、日本語の案内に置き換えます。日時は日本語表記で、タイムゾーンは利用端末の設定に従います。言語切り替え機能は追加していません。日本語変換中のEnterで保存せず、Escapeで編集欄を閉じないようにしています。

- URLを入力欄に貼り付けてEnter。まずホスト名で即時保存し、バックグラウンドでページの `<title>` とfaviconを取得します。入力欄が空になったら続けて追加できます。取得失敗でも追加は成功します。
- `新しいフォルダー` は一覧内に名前入力行を作ります。Enterで保存、Escapeでキャンセル。既存フォルダーの `名前を変更` も同じ行内入力です。
- フォルダー名を押すと開き、パンくずで戻ります。ブラウザーの戻る・進むにも対応します。
- 各行のその他メニューから `名前を変更` / `編集`（リンクのみ）/ `移動` / `削除` を選びます。右クリック、Shift+F10、コンテキストメニューキーでも同じメニューを開けます。タッチ用ボタンは常時表示します。
- リンクの `名前を変更` は名前のみ、`編集` は名前とURLを編集します。`移動` は同じ行で移動先を選択します。
- 項目メニューの `上へ移動` / `下へ移動` で順序を保存します。ドラッグは不要で、タッチ・キーボードでも並べ替えできます。
- メニューは上下矢印・Home・Endで移動し、Escapeで閉じます。行内フォームもEscapeでキャンセルできます。
- 残り時間はタイトル横に表示し、押すと削除予定日時が分かります。`Binderを削除` はその他メニュー内にあり、項目削除・Binder削除とも確認が必要です。
- 保存中は操作を無効化し、失敗時は入力を保持します。フィードバックは操作場所の近くに表示し、成功表示は約3.5秒で消えます。
- テーマは `端末に合わせる` が初期値です。`ライト` / `ダーク` も選べ、テーマのみlocalStorageへ保存します。既存のテーマ設定はそのまま引き継ぎます。

閲覧・編集で共通の一覧とナビゲーションを使い、閲覧画面では作成・編集・削除操作を表示しません。Folder移動で再構築するのはパンくずと一覧だけで、タイトルやURL入力欄のDOMは保持します。保存後はAPIの応答を一覧へ反映し、全画面の再構築は行いません。メタデータ取得中だけ最大6回、1秒間隔でBinderを確認し、編集・移動・選択中のUIを壊さずタイトルとfaviconを更新します。認証・168時間の有効期限・Cronの仕様は維持しています。

`npm run dev` はViteでビルド後、WranglerのローカルWorkerからフロントエンドとAPIを同一オリジンで配信します。フロントエンド変更後は別ターミナルで `npm run build` を実行し、ブラウザーを再読み込みしてください。Workerの変更はWranglerが検知します。

ローカルD1は `.wrangler/state/` に永続化されます。クラウドのDBは使用しません。`.wrangler/` の削除はローカルデータの消去になるため、通常のセットアップでは不要です。

## 構成

```text
src/
  worker.ts                   Hono API、認証、Cron、保存済みfaviconの配信
  creation-limit.ts           IP正規化・日単位HMAC・日本時間のリセット時刻
  metadata.ts                 URL / DNS検証、上限付きHTML・favicon取得
  enrichment.ts               waitUntil処理、取得予算・世代・手動タイトル保護
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
  0003_link_metadata.sql      既存データを保持してメタデータ用カラムを追加
  0004_daily_creation_limits.sql  日単位の作成上限カウンター
tests/
  setup.ts                    ローカルD1のマイグレーション適用
  api.test.ts                 実D1 / workerdでの統合テスト
  locale.test.ts              日本語エラー・残り時間の境界テスト
  creation-limit.test.ts      IP正規化・HMAC・日本時間の境界テスト
  creation-limit-api.test.ts  50件上限・同時実行・ロールバック・Cron
  metadata.test.ts            外部HTTPを制御した取得・解析・SSRF境界テスト
  metadata-api.test.ts        実D1での非同期取得・競合・配信テスト
  metadata-browser.mjs        自動反映・手動編集中・アイコン失敗のUI検証
  browser.mjs                 Playwright CLI用ブラウザーフロー
vite.config.ts
vitest.config.ts
wrangler.jsonc
```

実行時依存はHonoと `entities` のみです。HTMLRewriterは文字参照を生のまま返すため、HTML5の名前付き・数値文字参照を正しくデコードする専用ライブラリを使います。React、認証サービス、外部フォント、解析SDK、第三者faviconサービスは使用していません。`package-lock.json`をコミットし、開発ツールの間接依存undici / zodは修正版の互換メジャーへoverrideしています。

## 同一IPからの作成上限

- **日本時間（UTC+9）の0時〜24時に、同一IPから成功したBinder作成を50件まで**許可します。51件目はHTTP 429と `Retry-After`（次の日本時間0時までの秒数）を返し、日本語で案内します。過去24時間のローリング制限ではありません。
- Binderを削除しても件数は戻りません。既存の全体上限（保持中の直近1時間20件・全体2,000件）も引き続き適用します。その制限やDB障害等で作成に失敗した場合、IPの枠は消費しません。
- 接続元はCloudflareが設定する `CF-Connecting-IP` だけを使用し、`X-Forwarded-For` / `X-Real-IP` は信用しません。IPv4 / IPv6の表記を正規化し、IPv4-mapped IPv6も同じIPv4として数えます。IPが欠落・不正な場合は制限を迂回せず503にします。
- D1には日付を含む **HMAC-SHA-256識別子・成功件数・リセット時刻だけ**を保存します。平文IPやBinderとの対応表は保存しません。日付が変わると識別子も変わります。
- カウンター予約とBinder挿入をD1の同じトランザクション（batch）で行います。同時リクエストでも50件を超えず、挿入失敗時は予約もロールバックします。
- 日付境界をまたぐ処理を保護するため前日分は保持し、その翌日の0時以降にCronで削除します（1回最大1,000件、遅延・バックログはあり得ます）。通常の保持期間は約24〜48時間＋Cron遅延です。
- 共有回線・学校・会社・VPN等では同一IPの利用者で50件を共有します。IPを変更できる利用者やbot全般を防ぐものではありません。

### HMAC鍵の設定

`IP_RATE_LIMIT_SECRET` は32文字以上のランダムな秘密値を使用します。上記のローカルセットアップは256bitの鍵を `.dev.vars` に生成し、Gitには含めません。生成・変更後は開発サーバーを再起動してください。未設定・短すぎる鍵では作成APIが503になります。

**本番公開時には、明示的な許可を得たうえで**WorkerのSecretとして別途設定してください（この作業では未実施）。値をログ・チャット・Gitへ貼り付けないでください。

```sh
# クラウド変更。許可後のみ実行し、秘密値は安全な方法で入力する
npx wrangler secret put IP_RATE_LIMIT_SECRET
```

鍵を日中に変更するとその日の識別子が変わり、作成枠が実質リセットされます。通常の再起動やデプロイでは同じ鍵を維持してください。Wranglerローカル環境では接続元ヘッダーの信頼境界が本番と異なるため、開発サーバーを外部公開しないでください。

## 自動メタデータ

- 新規リンクのタイトルは **HTMLの `<title>` → ホスト名** の順です。`og:title` は採用しません。文字参照を一度だけデコードし、前後・連続空白を正規化して200文字以内に収めます。
- faviconは **適切な `rel="icon"`（`shortcut icon`を含む）→ 最終ページの `/favicon.ico` → 汎用アイコン**。相対パスはリダイレクト後のページURLで解決します。候補は最大8件から16 / 32pxまたは `any` を優先し、HTML内候補を1件だけ試します。
- PNG / ICO / SVGに対応します。Content-Typeとファイル先頭・構造を検査し、PNG（ICO内のPNGも含む）は最大512×512。SVGはスクリプト・イベント・外部参照・CSS・フィルター・XML実体等を含まない保守的なサブセットに限定します。それ以外は汎用アイコンに戻ります。
- **追加操作は外部取得を待ちません。** `waitUntil` で取得し、UIは編集可能なままです。失敗通知を大量に出さず、ホスト名・汎用アイコンを維持します。プロセス停止等で背景処理が完了しなくてもリンクは保存済みです。次回表示時に外部取得を再実行しません。
- 手動Renameは明示的なフラグで保護します。同じミリ秒に同じ名前へ変更した場合でも、自動取得で上書きしません。URL変更時は世代番号を更新し、旧URLの遅い結果を破棄。現在のタイトルを保持してfaviconだけを再取得します。
- 既存リンクはマイグレーション時に「手動タイトル」として扱い、変更・一括取得しません。favicon未取得なら従来の汎用アイコンです。
- 保存したアイコンのみを `/api/binders/:id/nodes/:nodeId/favicon?v=世代番号` から配信します。閲覧GETで外部取得しません。faviconのURLを指定できる公開プロキシも作りません。画像が読み込めなければ18pxの汎用アイコンに戻ります。
- アイコンはD1に保存する取得キャッシュです。ブラウザーキャッシュは `private`、最大1時間、かつBinderの期限までに限定。SVGの直接表示にも `sandbox; default-src 'none'`、nosniff、同一オリジン限定のリソースポリシーを適用します。

### 取得上限・ネットワーク境界

| 対象 | 制限 |
| --- | --- |
| 1ジョブの合計時間 | DNS・HTML・画像を合わせて2.5秒 |
| HTML | ストリームの先頭256KiBだけ読み、残りをキャンセル |
| favicon | 32KiBまで。超過・MIME不一致は拒否 |
| DNS応答 | 1応答32KiB、A / AAAAの両方を検証 |
| リダイレクト | 各リソース最大2回、毎回URL / DNSを検証 |
| 外部取得ジョブ | Binderの生存期間全体で最大400回。並行更新でも超過不可 |

http / httpsの標準ポートのみを取得します。認証情報付きURL、localhost、単一ラベル・内部用ホスト名、プライベート・ループバック・リンクローカル・予約IP、IPv4埋め込み・移行用IPv6等を拒否。DNSが複数IPを返す場合は1件でも非公開アドレスがあれば取得しません。リダイレクトを自動追跡せず、外部へAuthorization・Cookie・編集URLのフラグメントを送りません。

DNSチェックは接続IPを固定するものではありません。DNS rebindingを含む最終的な内部ネットワーク拒否は、[Workersの公開通信プロキシ](https://developers.cloudflare.com/workers/reference/security-model/)と明示した **`global_fetch_strictly_public`** に依存します。このフラグを削除したりVPC接続等へ置き換えたりしないでください。Wranglerローカル環境は本番のネットワーク分離を再現する保証がないため、開発サーバーを外部公開しないでください。Node等への単純移植ではこの境界が失われます。

この機能のためのKV / R2 / 有料サービスは追加していません。ただし外部取得・DNS・D1書き込み・ポーリング・画像配信で無料枠を消費します。最悪1 Binderで200×32KiB（約6.25MiB）の画像領域が必要になり、DBの500MB上限に達し得ます。400回制限は濫用を抑える上限であり、全体の枠内利用や完全なbot対策を保証しません。

## DBスキーマ

時刻はすべてUTC Unix epochミリ秒です。

| テーブル | カラム |
| --- | --- |
| `binders` | `id` PK、`title`、`edit_token_hash`、`created_at`、`expires_at`、`updated_at`、`metadata_requests` |
| `nodes` | `id` PK、`binder_id` FK、`parent_id` nullable FK、`type`、`title`、`url` nullable、`sort_order`、`created_at`、`updated_at`、`title_is_manual`、`metadata_status`、`metadata_version`、`favicon`（BLOB）、`favicon_type` |
| `binder_creation_limits` | `ip_day_hash` PK、`reset_at`、`created_count`（1〜50） |

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
| GET | `/api/binders/:id/nodes/:nodeId/favicon` | 保存済みfavicon（期限内のみ） | 不要 |
| GET | `/api/binders/:id/access` | 編集権限の確認 | 必要 |
| DELETE | `/api/binders/:id` | Binder全削除 | 必要 |
| POST | `/api/binders/:id/nodes` | Folder / Link作成 | 必要 |
| PATCH | `/api/binders/:id/nodes/:nodeId` | 名前 / URL / 親を変更 | 必要 |
| DELETE | `/api/binders/:id/nodes/:nodeId` | Nodeと配下を削除 | 必要 |
| PUT | `/api/binders/:id/reorder` | 同一階層の並び替え | 必要 |

```jsonc
// POST /api/binders/:id/nodes
{"type":"folder","title":"Research","parent_id":null}

// Linkはtitle省略で自動タイトル。title指定なら手動名を維持しfaviconだけ取得
{"type":"link","url":"https://example.com/","parent_id":null}
{"type":"link","title":"Documentation","url":"https://example.com/","parent_id":null}

// PATCH /api/binders/:id/nodes/:nodeId（指定した項目のみ更新）
{"title":"Sources","parent_id":null}

// PUT /api/binders/:id/reorder（全兄弟のIDを順番通りに指定）
{"parent_id":null,"ids":["NODE_ID_2","NODE_ID_1"]}
```

Nodeレスポンスには `metadata_status`（none / pending / ready / failed）と `favicon_url`（未取得時null）が追加されます。アイコンのバイナリや内部フラグ・世代管理用カラムを一覧JSONに含めません。

JSONのリクエストには `Content-Type: application/json`、編集リクエストには `Authorization: Bearer SECRET_TOKEN` を送ります。編集URLは `/b/ID/edit#SECRET_TOKEN`。フラグメントはHTTPリクエストやRefererには含まれません。トークンは作成時に1回だけJSONで返し、閲覧APIにはハッシュもトークンも返しません。

主なレスポンス：作成201、取得・更新200、削除204、不正入力400、認証エラー401、存在しない・期限切れ404、集合の競合・項目上限409、サイズ超過413、Content-Type違い415、作成上限429、IP・HMAC鍵を確認できない場合は503。予期しないDBエラーは内部情報を出さず500です。

### 有効期限とCron

期限の判定は **`now >= expires_at` でアクセス禁止**。GET時はデータ取得後にも検査します。Node作成・更新はDB実行時にも期限を検査し、削除SQLもDB実行時の時計で確認します。閲覧・編集APIの期限拒否はCronの実行を待ちません。

Cronは15分ごと、1回最大10 Binderを期限順に物理削除します。大量のカスケード削除を1回に集中させないための制限です。障害や大量データで未削除の期限切れデータが残ってもアクセスは禁止されます。物理削除の完了時刻は7日ぴったりではありません。同じCronで古い作成上限カウンターも最大1,000件削除します。

Cloudflareのバックアップ / Time Travelの保持期間はアプリ側の削除と別です。「物理削除」は稼働中DBからの削除を指し、プラットフォームのバックアップから即座に消去する保証ではありません。

## テストと検証

```sh
npm run check       # TypeScript（Worker / UI / tests）、Vitest、Vite build
npm test
npm audit
npx wrangler deploy --dry-run --outdir /tmp/binder-worker-dryrun
```

VitestはCloudflare公式プラグインで**ローカルworkerdとD1**を動かし、実マイグレーションを適用します。DBのモックは使いません。各テスト前の消去は独立したテストDBだけが対象で、開発用 `.wrangler/state/` には触れません。

自動メタデータ追加後の検証結果：

- **126テスト成功**（既存API20件、日本語表示22件、メタデータ55件、メタデータD1統合7件、日次キー14件、日次制限API8件）。50件成功・51件目拒否、削除後の枠維持、IP別枠、同時実行、失敗時のロールバック、JST日付境界、ヘッダー偽装対策、鍵欠落時の拒否、Cron清掃を確認しています。D1統合テスト：作成、3階層Folder、Link作成・編集、移動、循環 / 異なるBinder / Link親の拒否、Node・配下一括・Binder削除、全更新APIのトークン検証、他Binderのトークン拒否、並び替え・不正な集合の拒否、期限直前 / ちょうど期限、期限後の各更新拒否、処理中の期限超過、Cron、期限不変、不正URL7パターン、入力制限、同時作成での上限検証など。
- TypeScript・Viteビルド成功。外部HTTPだけをモックし、HTMLRewriter・実D1マイグレーション・背景ジョブ・画像配信は実装を通して検証。タイトル優先、文字参照、相対favicon、PNG / ICO / SVG、サイズ・時間上限、DNS / リダイレクト拒否、手動名・既存行・URL世代保護、400回予算の競合をテストしています。
- 実際の外部取得もローカルWorkerで確認。`example.com` は保存8ms（1回の観測値、性能保証ではありません）で返り、後から `Example Domain` に更新。GitHubはページタイトルと958バイトのPNG faviconを取得し、同一オリジンの画像APIが200を返しました。検証用Binderは削除済みです。
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
node "$PW" run-code "$(node --input-type=module -e 'import { runMetadata } from "./tests/metadata-browser.mjs"; process.stdout.write(runMetadata.toString());')"
node "$PW" run-code "$(node --input-type=module -e 'import { run } from "./tests/browser.mjs"; process.stdout.write(run.toString());')"
node "$PW" close
```

`metadata-browser.mjs` は制御されたAPI / 画像のfixtureで、自動タイトル反映、18px favicon、取得中の編集、手動名・既存名維持、画像404時の汎用アイコン、Light / Darkを検証します。外部サイトの内容変化に依存しません。画像は本番と同じsandbox CSPで描画確認し、画面は `/tmp/binder-metadata-light.png` と `/tmp/binder-metadata-dark.png` に保存します。外部取得の安全性・DB保存は別途Worker統合テストで検証します。

既存の `browser.mjs` は回帰テスト用にホスト名を明示した手動タイトルのfixtureを使用し、そのほかの実API操作は維持します。

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

- アカウント・メール・アクセス履歴をDBに収集しません。作成制限のためIPを処理しますが、平文IPは保存せず、D1に日単位HMACと作成件数等だけを保存します。Worker側でIP・リクエスト・トークン・入力内容をログ出力しません。Observabilityは無効です。ただしCloudflare等のプラットフォーム自身によるログ保存まで制御するものではありません。
- 編集URLはBearer権限です。URLを知る全員が変更・全削除できます。ブラウザー履歴、拡張機能、クリップボード、画面共有からの漏えいに注意してください。トークン回復・ローテーションはありません。
- 閲覧URLも秘密文書向けの認証ではありません。URLを知る誰でも閲覧できます。機密情報を置かないでください。
- 入力をHTMLとして挿入せず `textContent` を使用。CSP、frame-ancestors、nosniff、no-referrer、Permissions-Policy、noindex、no-storeをAPIとStatic Assetsへ設定。
- SQLの値はすべてバインド。動的なSET句はコード内の固定カラム名のみです。
- URLはhttp / https限定。資格情報を含むURLや制御文字を拒否。外部リンクは `target="_blank" rel="noopener noreferrer"`。新規リンクとURL変更時のHTML / faviconのみを検証付きで自動取得します。JavaScript実行やOGP取得は行いません。
- 他オリジンからの更新を拒否。Cookie認証やCORS許可は使いません。
- 名前200文字、URL 2,048文字、JSONリクエスト16KiB、1 Binder 200 Node。FolderもNodeとして数えます。最大階層数もNode上限によって制限されます。
- DBトリガーで、保持中データのうち直近1時間の作成数20件、全体2,000 Binderを上限とし、同時作成も制限。**これはサービス全体の初期運用制限**です。

### 限界と公開前の推奨

上限は本格的なbot対策ではありません。攻撃者が作成枠を占有すれば正規ユーザーも作成できなくなり、作成後すぐ削除するbotは保持行ベースの作成制限を迂回できます。閲覧連打や不正トークンのリクエストだけでもWorkers / D1の無料枠を消費します。

公開前に、無料の**Cloudflare TurnstileをBinder作成に適用**し、サーバー側で検証することを推奨します。専用ドメインがあればFreeプランで使えるWAFルール等も検討してください。これらは未設定で、既存アカウント資源を勝手に作成・変更していません。同一IPの日次50件制限は実装済みです。必要なら将来、サービス全体の削除に影響されない時間帯別カウンターや停止スイッチを追加します。

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
- [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)
- [Workers fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
- [公開fetchの互換フラグ](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
- [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
