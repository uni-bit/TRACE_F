# TRACE 参加者向けフロントエンド設計

- 対象リポジトリ: `C:\Users\uni11\TRACE_F`
- 対象: TRACE 参加者向け Web App
- 実装前提: Next.js 16.3.0 / React 19.2.8 / TypeScript / App Router
- 状態: フロントエンド設計レビュー済み。18節のAPI・運用契約は実装前に確定が必要
- 文書の目的: Go Backend が定義する参加者向け契約を、ブラウザ上で安全に実装するための設計を定める
- 非対象: 運営画面、描画クライアント、Go Backend、DB、3D表現そのもの

この文書は `C:\Users\uni11\trace-campus-installation\docs\README.md` の優先関係に従う。矛盾がある場合は、目的・公開条件、スコープ要件、写真メモリー仕様、API仕様、状態機械、プライバシー設計の順に解決し、フロントエンドが未決事項を推測して補完しない。

## 1. 参照仕様との照合結果

### 1.1 フロントエンドが必ず満たすこと

`scope-requirements.md`、`user-journey.md`、`photo-memory.md`、`privacy.md`、`state-machine.md`から、参加者フロントに直接関係する必須条件を次のように固定する。

| 領域 | 設計上の拘束 |
|---|---|
| 同意 | 作品側の説明と同意を完了するまで、カメラ・位置APIを一切呼ばない。カメラ同意、Live位置同意、到着後の`on_site`同意を分ける |
| セッション | `MemorySession`と`LivePresenceSession`は別ID・別トークン・別同意。Memory-onlyではLiveセッションを作成せず、`watchPosition`と通常GPS送信を行わない。Memory同意後の撮影操作では、写真アンカー目的の単発`getCurrentPosition`だけを許可する |
| 通常GPS | 通信できた最新1点だけを送る。通信失敗点をメモリ、IndexedDB、localStorage、Service Worker、再送キューへ残さない |
| 撮影時GPS | 写真と一緒に上限付きで一時保持・再送してよい。通常GPSから補完しない |
| 写真 | ブラウザで向き補正、EXIF除去、長辺1920px以下への縮小、JPEG/WebP再エンコードを行ったBlobだけを送る |
| 写真の失敗 | 写真の保存失敗は写真単位で表示し、再送、端末保存、削除を選べる。写真0枚でも到着・演出・終了を妨げない |
| 到着 | 有効な到着QRだけを送信し、冪等に到着登録する。到着だけで`on_site`へ進めず、停止または追加同意を要求する |
| 表示 | 公開スクリーンへ原写真、画像URL、生GPS、正確な時刻、完全なセッションIDを渡さない |
| 削除 | 追跡停止と保存データ削除を分ける。写真だけ、Liveだけ、両方を選べる。部分失敗では完了側を復活させず未完了側だけ再試行する |
| 保持 | 参加トークンはURL、ログ、`localStorage`、IndexedDBへ保存しない。API仕様に従い、同一タブの再読込に必要な範囲で`sessionStorage`を使う。写真加工Blob、撮影時GPS、写真再送キーだけがIndexedDBの対象 |

### 1.2 初稿からの修正点

| 初稿の記述 | 判定 | 改訂方針 |
|---|---|---|
| 資格情報をIndexedDBへ保存 | `api.md` 509行目と衝突 | トークンは同一タブの`sessionStorage`だけ。別タブへcredentialを渡さず、外部QRタブからproofだけを所有タブへ通知する |
| 到着QRをURL fragmentで受ける | 望ましいがAPI未確定 | fragmentを必須候補とする。query形式を許す場合はサーバー・プロキシのアクセスログ抑止まで契約化する |
| `memoryConsentVersion`と`livePresenceConsentVersion`を公開configから取得 | 現行`api.md`のconfig例は単一`consent` | 実装前にAPIを構造化された同意文へ改訂する。フロントが版を暗黙生成しない |
| Memory-onlyで到着を継続 | APIの`experienceLinkToken`の必須性が曖昧 | Memory-onlyの到着リクエストでlinkを省略可能か、APIに明記するまで未決とする |
| 削除結果を単一の成功・失敗で扱う | `DELETE /experiences`は部分結果の形式未定義 | セッション単位の結果、再試行対象、資格情報の失効状態を返す契約を追加する |
| upload queueを常時workerとして動かす | タブ・背景化・終了で不安定 | 参加中の所有タブだけが処理し、再読込時はIndexedDBと`GET /photos`を照合する。通常GPSはworker対象外 |

## 2. 体験の範囲と画面

### 2.1 対象範囲

- 入口説明、言語切替、受付状態の表示
- 写真メモリーとLive位置の個別同意
- カメラ・位置の権限要求と拒否時の代替導線
- Web App内撮影、写真確認、加工、アップロード、再送、削除
- 最新位置の送信、追跡状態、停止
- 到着QRの取得、到着登録、待機、演出のskip
- 到着後のLive停止または`on_site`追加同意
- 本人端末だけの写真ストーリー閲覧と端末保存
- 写真だけ、Liveだけ、両方のデータ削除

### 2.2 対象外または後続

個人アカウント、SNS共有、ランキング、正確な屋内階層判定、行動分析、公開写真、自動Vlog、NFC、Web Push、QRチェックポイントによる代替軌跡、PWA常駐化はMVPの必須経路に含めない。Web PushはAPIと同意が確定した後に独立機能として追加する。

### 2.3 ルート

ルートは表示上の入口であり、状態の正本ではない。再読込や別タブからの復帰時は必ずBackend状態を取得して遷移を決める。

| Route | 役割 | Client化する範囲 |
|---|---|---|
| `/` | 入口、受付状態、概要 | 公開config表示のみ。ブラウザ権限は呼ばない |
| `/consent` | 同意文の表示、Memory/Live選択、開始 | 同意チェックと作成要求 |
| `/experience` | 撮影、追跡状態、停止 | カメラ、位置、写真キュー、状態表示 |
| `/arrival` | QR tokenの受け取り、到着登録 | URL消去、タブハンドオフ、QR API |
| `/arrival/waiting` | 色・記号、待ち順、再生状態、skip | 状態取得とskip |
| `/memory` | 写真ストーリー、端末保存 | 画像URLの短期取得、写真表示・削除 |
| `/settings/data` | 停止、写真単位削除、範囲削除 | 確認、進行、部分失敗の再試行 |
| `/alternative` | カメラ・位置なしの観覧または参加案内 | 権限APIを呼ばない |

到着後は`/arrival/waiting`、`/memory`、`/settings/data`のいずれからでも有効な範囲の操作へ戻れる。`arrived`、`queued`、`on_site`などをURLだけで表現しない。

## 3. システム境界

```text
Browser
  Next App Router
  ├─ Server Components: 公開configの外枠、静的な説明、metadata
  └─ Client Components: 同意後のAPI、権限、カメラ、位置、IndexedDB、タブ調停
       |
       | HTTPS JSON / private signed PUT
       v
  Go Backend + private object storage
       |
       └─ 抽象化済みイベント -> 公開描画
```

Next.jsのServer Componentは参加者トークン、撮影時GPS、写真Blob、署名付き画像URLを取得・保持・ログ出力しない。参加開始後のBearer token付き通信は、Client Componentから`/v1`のAPI adapterを通じて行う。Server Action、Server Componentのprops、Nextのキャッシュ、Route Handlerをトークン中継に使わない。

NextとGoを同一originのリバースプロキシ配下に置く構成を推奨する。別originの場合はGoで本番Web AppのoriginだけをCORS許可し、`credentials: include`に依存せずBearer tokenを明示する。CORS、TLS、body size、レート制限はフロントで代替できないため、Backend契約の必須条件とする。

### 3.1 Server / Client境界

Server Componentに置いてよいもの:

- 公開configを表示するための静的な外枠。ただし動的configをNextの共有キャッシュに入れない
- 受付停止、言語、説明ページの構造
- `metadata`、エラー境界、loading UI

Client Componentに限定するもの:

- `navigator.geolocation`、`getUserMedia`、`input[capture]`
- `sessionStorage`、IndexedDB、`BroadcastChannel`、Web Locks、`postMessage`
- 同意後のセッション作成、Bearer付きAPI、写真PUT
- 位置watch、写真の加工、Object URL、停止・削除の副作用

Client Componentのルートでも、権限要求はmount時に自動実行せず、同意完了後の明示操作からだけ呼ぶ。Serverから渡すpropsは公開configとUI用の非機密データに限定する。

## 4. ドメインモデルと状態

### 4.1 状態の正本

| 層 | 保存場所・正本 | 例 |
|---|---|---|
| Server state | Go Backend | `trackingStatus`、`presencePhase`、`replayStatus`、写真status、削除status |
| Tab session state | 当該タブの`sessionStorage` | 3種類のtoken、session ID、experience ID、期限 |
| Durable local photo state | IndexedDB | 加工済みBlob、撮影時GPS、clientPhotoId、写真用冪等性キー、local expiry |
| Ephemeral device state | メモリのみ | 最新通常GPS 1件、watch ID、in-flight request、カメラstream |
| View state | React state/reducer | モーダル、フォーカス、表示中エラー、選択言語 |

`sessionStorage`は同一タブの再読込用であり、別タブとは共有されない。トークンをIndexedDB、localStorage、Cookie、URL、Service Workerへ複製しない。`sessionStorage`もXSSから保護する仕組みではないため、第三者スクリプト、危険なHTML挿入、過剰な依存、URL/consoleへの出力を禁止する。

### 4.1.1 端末内写真レコードの期限と孤児化

IndexedDBの各写真レコードは、サーバーのsession IDやtokenではなく、クライアント生成の`localSessionRef`で参加単位を識別する。最低限、次を持つ。

```text
localSessionRef
clientPhotoId
processedBlob
capturedAt
capturedLocation (optional)
photoOperationKeys
localExpiresAt
localDeleteAfter
```

`localDeleteAfter`はサーバーの`deleteAfter`を超えない。サーバー期限がまだ取得できない場合も、公開前に承認された端末内最大保持期限を必ず設定し、無期限のローカル保持を許可しない。`localExpiresAt`は再送処理の期限であり、いずれか早い方に到達したら端末データを消す。

次のタイミングで、cleanup coordinatorの1タブだけが期限掃除を実行する。credentialの有無はowner不在確認の一要素であり、単独の削除条件ではない。

- アプリ起動、ページ復帰、写真画面を開く時に期限切れレコードを全走査する
- `localExpiresAt`または`localDeleteAfter`到達時にtimerで掃除する。ただしtimerは補助であり、次回起動時にも再走査する
- サーバーが`ready`または削除済みであることを確認した場合、対応する端末Blob、撮影時GPS、preview、写真用キーを消す

IndexedDBはorigin共有、`sessionStorage`はタブ単位なので、credential欠損だけでは孤児と確定しない。掃除を実行できるのは、現在の参加所有権を持つタブ、またはその所有タブが不在であることを確認したcleanup coordinatorの1タブだけである。外部QRタブ、非所有タブ、所有権を取得できないタブは掃除を実行しない。

掃除の調停は次のように行う。

1. 所有タブは`trace:experience:<localSessionRef>`のWeb Lockを保持し、BroadcastChannelへ短いheartbeatを送る
2. cleanup coordinatorは`trace:local-cleanup`のWeb Lock、非対応時はIndexedDBに置くtokenを含まない短TTL leaseを取得した1タブだけが動作する
3. coordinatorはactive ownerのheartbeat、Web Lockの取得状況、BroadcastChannelの応答を確認する。credentialがない外部QRタブ・非所有タブからはcleanup完了通知を受け付けない
4. 一時的な再読込・タブ切替を孤児と誤判定しないため、owner heartbeatが途絶えてから初期60秒のgrace periodを置く。期間中は当該`localSessionRef`を削除しない
5. grace period後も所有タブが不在で、他タブから有効owner応答がなく、Web Lock/leaseも取得できる場合だけ孤児と確定し、端末内データを削除する
6. 所有タブが再登場、heartbeatを返す、またはWeb Lockを取得した場合は掃除を中止する

期限切れの定期掃除もこの1タブ調停を通す。外部QRタブ・非所有タブは期限timerを含む削除処理を実行せず、必要ならownerへ非機密の掃除要求だけを通知する。

`failed`は端末Blobの削除条件ではない。retryable/non-retryableを表示し、retryableなら再送、non-retryableでも利用者の端末保存または写真削除を選べるようにし、どちらも選ばれない間は上限内でBlob・撮影時GPS・写真用キーを保持する。利用者の選択またはlocal expiryで初めて端末側を消す。サーバー上の不正objectをBackendが削除することと、端末Blobを保持することは別処理である。

grace period後の端末削除は、サーバーデータ削除の成功を意味しない。端末内の写真と撮影時GPSだけを消し、サーバー側は`deleteAfter`の期限ジョブまたは利用者が有効credentialを持つ間の削除操作で消す。この違いを画面に表示する。サーバー削除が部分失敗しても、端末Blobを復元しない。

### 4.2 直交する状態

巨大な一つのenumを作らず、次の状態を独立に管理する。

```text
trackingStatus: tracking | stopped | expired
presencePhase: approaching | arrived | on_site | ended | absent
replayStatus: none | queued | playing | completed | skipped
memoryAvailability: absent | active | deleted | expired
permission.camera: not_requested | granted | denied | unavailable
browserPermission.location: not_requested | granted | denied | unavailable
consent.memoryPhotoLocation: not_accepted | accepted
consent.livePresenceLocation: not_accepted | accepted
consent.onSiteLocation: not_accepted | accepted
connectivity: online | degraded | offline
deletion.memory: idle | deleting | deleted | failed
deletion.live: idle | deleting | deleted | failed
```

`absent`はMemory-onlyでLiveセッションが存在しないことを表す。Liveがない場合、`trackingStatus`や`presencePhase`を偽の`stopped`として表示せず、「リアルタイム位置には参加していません」と表示する。

### 4.3 Backendとの同期

- 初回のセッション作成後、再読込、復帰、到着待ち、削除後に状態APIを取得する
- ローカル状態は表示の先行反映に使えても、終端状態の確定に使わない
- `GET /v1/experiences/{experienceId}`は位置点を返さない。参加端末で地図上の生位置を再構成しない
- 通信断は永続状態として保存せず、最終成功時刻から画面上で`degraded`を導出する
- 端末時刻を到着・停止・削除の確定時刻にしない。サーバー応答を正とする

## 5. 資格情報、タブ、QR

### 5.1 資格情報の種類

API adapterはtokenの種類を型で分け、汎用的な「現在のtoken」を作らない。

```text
MemoryCredential: memorySessionId + memoryParticipantToken
LiveCredential: livePresenceSessionId + liveParticipantToken
LinkCredential: experienceId + experienceLinkToken
```

各credentialは当該タブの`sessionStorage`に保存する。保存値には`expiresAt`、`deleteAfter`、同意version、作成時刻を付けるが、生の位置や写真Blobは含めない。ログ、エラー報告、analytics、画面文言にtokenを出さない。

削除成功、サーバーが期限切れを確認、参加情報を消去、破損検出のいずれかで対応credentialを消す。ただし両方削除の部分失敗では、成功した側のcredentialだけを消し、未完了側の再試行に必要なcredentialは残す。経験リンクはBackendの仕様どおり、片側の削除成功時点で使えなくなる前提で、再到着用に保持しない。

### 5.2 複数タブの所有権

同じoriginの複数タブで、通常位置watchと写真uploadを二重に動かさない。

1. 各タブは機密情報を含めず、`BroadcastChannel`で同一experienceの存在だけを通知する
2. `Web Locks API`が使える場合、`trace:experience:<experienceId>`を保持するタブを所有タブとする
3. 非所有タブは状態閲覧と操作要求の表示だけを行い、位置watch、写真worker、定期pollを開始しない
4. Web Locks非対応時は、短TTL・更新時刻・ランダムownerを持つ非機密leaseで代替する。leaseはtokenを含めない
5. 所有権を失ったタブはwatch、upload、pollを停止し、late responseを無視する
6. 到着、停止、削除、写真作成はサーバーの冪等性キーでも重複を防ぐ

非所有タブが操作ボタンを押した場合、所有タブへ非機密の操作要求を通知するか、利用者に所有タブへ戻る案内を出す。tokenをBroadcastChannelへ流さない。

### 5.3 到着QRを扱う2つの導線

到着QRは参加credentialと別の短期`checkpointToken`である。QRの推奨形式はURL fragmentとする。fragmentを受け取った画面は最初のClient処理でproofをメモリへ移し、URLを消す。

```text
/arrival#checkpointToken=<short-lived-proof>
  -> checkpoint proofだけをmemoryへ移す
  -> history.replaceState(null, "", "/arrival")
```

fragmentはHTTP Refererやサーバーアクセスログへ送られない。query形式を採用する場合、フロントの`replaceState`だけでは初回HTTPリクエストのログ残留を防げないため、Go、Next、リバースプロキシのアクセスログでqueryをredactし、`Referrer-Policy: no-referrer`を設定することをAPI/運用契約に追加する。

主導線は次の二つであり、どちらもMemory/Live/Link credentialをタブ外へ出さない。

#### (a) 参加中の所有タブ内で読む

参加中の所有タブでQRを読み取る。proofはメモリにだけ置き、利用者が「この到着QRを送信する」と確認した後、所有タブ自身が`sessionStorage`のcredentialで到着APIを実行する。別タブ、URL、BroadcastChannelへcredentialを渡さない。

#### (b) 外部QRスキャナが開いたタブからproofだけ渡す

モバイルの外部QRスキャナで開いたタブは`window.opener`を持たないことが普通なので、`opener`や`postMessage`に依存しない。外部QRタブは署名済みcheckpoint proofだけをBroadcastChannelで通知し、参加中の所有タブが自分のcredentialで到着APIを実行する。

1. 外部QRタブがproofをfragmentからメモリへ移し、URLを消す
2. `handoffId`、ランダムnonce、短い有効期限、proofを含む同一メッセージを固定channelへ送る。credential、experience ID、写真、位置は含めない
3. BroadcastChannelはメッセージを蓄積しないため、外部QRタブは同じ`handoffId`/nonce/proofを短いbackoff（例: 100ms, 250ms, 500ms, 1s）でack受信またはTTL到達まで再送する。各再送は同じ一つの論理handoffであり、新しいproofやkeyを作らない
4. 所有タブは`handoffId`で重複排除し、最初の受信時だけnonce・期限・proofの形式を検証して`received` ackを返す。処理中の同じhandoffには同じackを返し、再送ごとにユーザー確認を出さない
5. 所有タブは自分が現在の所有タブであることを確認し、画面上で一度だけ「到着QRを現在の参加へ適用しますか」とユーザー確認を求める。確認前に到着APIを実行しない
6. 確認後、所有タブだけが同じhandoffのproofを一回だけ到着APIへ適用し、Memory credentialと、存在する場合だけLink credentialを使う。API適用中・適用済みの重複メッセージでは再APIしない
7. 成否はproofを送った外部QRタブへcredentialなしの`confirmed`/`rejected`/`expired`だけ通知する。proof、nonce、メッセージ履歴はTTL到達またはack後に破棄する

固定channelは同一originの他タブから盗聴・偽造・再送され得る。したがってchannel名を秘密として扱わず、proof自体の署名・期限・サーバー側一回性、ランダム`handoffId`、所有タブ判定、明示的なユーザー確認、到着APIの冪等性を組み合わせる。BroadcastChannelにparticipant credentialを置かないことで、固定channelの盗聴がcredential漏えいにならないようにする。proofの再利用防止がBackend APIで保証されない場合は、この導線を有効化しない。handoffのTTL、再送回数、ack形式はAPI/フロント契約へ固定する。

active tabが閉じられている場合、`sessionStorage`方針上、参加credentialを復元できない。外部QRタブは到着だけを完了できず、「参加中の画面を開いたままQRを読む」「参加を再開するには入口から新しい参加を開始する」などの代替導線を表示する。孤児化した端末内写真は4.1.1の期限・credential欠損掃除で削除する。QR proofだけからcredentialや過去の参加を再発行しない。

### 5.4 非写真操作の冪等性キー

到着、Live停止、参加者skip、Memory/Live/Experience削除のキーは写真キューと分ける。非写真操作のキーは同一タブの`sessionStorage`に、tokenとは別の操作レコードとして保存する。

| 操作 | 保存先 | 保持条件 | 消去条件 |
|---|---|---|---|
| 到着 | `sessionStorage` | 同一到着操作の再送と状態確認に必要な間 | `arrived`または既存ArrivalEventをBackendで確認した直後に消してよい。未確認なら保持 |
| 停止 | `sessionStorage` | `stopped`または`ended`の確定まで | サーバー状態を確認した直後に消してよい。timeout/競合中は保持 |
| skip | `sessionStorage` | `skipped`の確定まで | 状態APIでskipを確認した直後に消してよい。skip endpointが未確定の間は実装しない |
| Memory/Live削除 | `sessionStorage` | 各側の結果確認と、失敗側の再試行に必要な間 | 成功側は削除確認後にcredential/keyを消す。失敗側だけを完了まで保持 |

キーは最初の要求前に生成し、timeoutや再読込でも同じ操作なら同じキーを再利用する。成功レスポンスだけでなくBackendの状態APIで終端状態を確認したら、データ最小化のためclient keyを消してよい。timeout、認証不明、状態未確認中は保持する。BackendがIdempotencyRecordを24時間保持するのはサーバー側の重複受付責務であり、clientがキーを24時間保持する要件ではない。削除の部分失敗では成功側のcredential/keyを成功確認後に消し、失敗側のcredential/keyだけを再試行完了まで保持する。

写真のmetadata作成・complete・upload URL再発行キーは加工済みBlobと同じIndexedDBレコードへ保存する。PhotoMomentが`ready`または削除済みであることを`GET /photos`等で確認してから、写真Blob、撮影時GPS、写真キーをまとめて消す。`failed`はretryable/non-retryableを確認しても端末Blobを自動消去せず、利用者の端末保存・写真削除またはlocal expiryまで保持する。通常GPSのキーやrecordは作らない。

## 6. 同意とセッション開始

### 6.1 入口

`GET /v1/public/config`を取得し、受付状態、言語、同意文、保存期間、位置間隔、写真上限、写真ピン条件を表示する。config取得失敗時は参加開始を許可せず、権限APIも呼ばない。

同意前に必ず表示する:

- 作品の目的、所要時間、任意参加、通信・電池への影響
- 取得する情報: 写真、撮影時刻、撮影時GPS、通常GPSの最新値、精度、匿名ID
- 取得しない情報: 氏名、学籍番号、メール、広告ID、端末固有ID、通常GPSの履歴
- 写真は本人用ストーリーに使い、公開スクリーンへ原写真を表示しないこと
- 通常GPSは通信できた最新値だけを送り、通信断中の履歴を保存・再送しないこと
- 写真撮影時GPSだけは写真送信のため上限付きで一時保持・再送すること
- 保存期間、停止、削除、問い合わせ先、未成年条件、外部委託先・保存地域が確定している範囲
- 画面ロック・アプリ切替で位置更新が止まる可能性
- 写真の第三者写り込み、名札、授業資料、撮影禁止場所への注意
- 端末へ保存してもサーバーの削除期限は延長されないこと

### 6.2 個別選択

写真メモリーとリアルタイム位置を別々のチェックボックスまたは選択肢で示す。カメラ権限とLive位置権限は別に説明し、拒否しても可能な体験を先に示す。

| 選択 | 作成するセッション | その後の権限 |
|---|---|---|
| Memoryのみ | Memoryのみ | カメラは任意。Memory同意後、撮影操作時だけ単発`getCurrentPosition`を使い、Live用`watchPosition`と通常GPS送信は行わない |
| Liveのみ | Liveのみ | カメラは呼ばない、位置許可後にwatch。ただし現行APIにはLive-onlyの到着契約がないため、MVPでは到着演出まで提供しない |
| Memory + Live | 両方とExperienceLink | カメラ・位置を各同意後に別々に要求 |
| 参加しない | なし | 権限APIは呼ばない |

APIの`POST /v1/experiences`へ、Backendが配信した同意versionと選択言語をそのまま送る。未知または古いversionで`409 CONSENT_VERSION_MISMATCH`になった場合はconfigを再取得し、内容を再表示して再同意する。

現行APIの到着endpointはMemorySessionを前提にしている。したがってLive-onlyを「到着演出まで含む参加」として提供するには、Live用到着endpointまたはMemoryを作らないExperience到着契約が必要である。契約追加前にLive-onlyを選択肢として有効化しない。

### 6.3 権限要求の開始条件と目的の分離

セッション作成成功と対応する同意が成立した後、目的ごとにブラウザAPIを呼ぶ。権限拒否はセッション作成失敗と扱わない。

- Memoryの撮影時GPS: Memory同意後、ユーザーがアプリ内シャッターを押した時、またはcapture付きfile inputでfileを受領した時にだけ、写真アンカー取得のため単発`getCurrentPosition`を開始する。リアルタイム表示、通常GPS履歴、Live送信には使わない
- Liveの通常GPS: Live同意後、ユーザーが位置利用を開始した時に`watchPosition`を開始する。通信できた最新値だけをLive展示へ送信し、写真アンカーへ流用しない
- カメラ: Memory同意後の撮影操作でだけカメラを開く。位置同意がない場合も写真は保存できる

同意文と画面ラベルも「写真を撮った場所の記憶に使う単発位置」と「歩行中のリアルタイム展示に使う位置」を別段落・別チェックで表示する。Memory同意だけではLive位置の用途に同意したことにならない。

目的同意とブラウザpermissionは別の状態である。OS/ブラウザは同一originの位置permissionを一つだけ表示・共有する場合があり、Memory撮影時GPSとLive通常GPSに別々のpermissionダイアログが出るとは限らない。`browserPermission.location=granted`でも、それだけでどちらの目的にも同意したことにはならない。

- `consent.memoryPhotoLocation=accepted`の撮影操作だけが単発位置取得の条件である
- `consent.livePresenceLocation=accepted`のLive開始だけが`watchPosition`と通常GPS送信の条件である
- 既にブラウザpermissionが許可済みでも、用途同意なしに別用途の位置APIを呼ばない
- ブラウザpermissionが拒否でも、単発位置なしの写真、またはLiveなしのMemory参加を継続する

## 7. Live用通常GPS controller

このcontrollerはLivePresenceSession専用である。Memoryの撮影時GPSは8節の撮影フローで単発取得し、このcontrollerには入れない。

### 7.1 送信アルゴリズム

1. Live同意が成立し、Live credentialが有効になった後にだけ`watchPosition`を開始する
2. callbackの位置を、メモリ上の`latestCandidate`一つへ上書きする
3. configの初期値5秒間隔で、送信中でなく、取得できた最新候補一つだけを送る
4. 送信開始時に候補を取り出して消す。新しいcallbackは送信中に一つだけ上書きする
5. 成功すれば`lastSuccessfulSentAt`だけを画面表示用に更新する
6. 失敗、429、認証切れ、停止、期限切れでは候補を破棄し、古い点を再送しない
7. 復旧後は新しいcallbackで取得した点から送る。`navigator.onLine`を送信成功の根拠にしない
8. stop/expire/delete/owner lossでwatch、timer、in-flight requestの結果適用を止める

停止との競合を防ぐため、controllerに世代番号を持たせる。停止時に世代を進め、古いcallback・Promiseの完了処理が表示や送信を再開できないようにする。

### 7.2 画面表示

次を常に表示する。

- 位置: `取得中`、`精度低下`、`送信待ち`、`更新停止`、`停止済み`、`位置なし`
- 最終成功送信からの経過時間
- 通信断、画面ロック、アプリ切替による制約
- 追跡停止とデータ削除は別操作であること

最終成功から30秒以上経過したら「現在、位置を更新できていません」と表示する。フロントは最後の通常GPS点を再送せず、BackendがTTL後に表示位置を消す。位置拒否または低精度でもMemoryや抽象軌跡へ進める。

### 7.3 送信禁止事項

- 失敗した位置のIndexedDB/localStorage保存
- Service Worker、Background Sync、汎用offline retryへの通常GPS登録
- React stateやURL queryに生緯度経度を保持
- 通常GPSを写真の撮影位置として補完
- 画面ログ、エラー報告、analytics、URLへ位置を出力

## 8. 写真撮影・加工・再送

### 8.1 撮影時刻と単発位置の同期

撮影経路を二つに分け、撮影時刻と単発位置取得の開始点を一致させる。どちらもMemory同意後の明示操作でだけ実行する。

- `getUserMedia`によるアプリ内シャッター: 利用者がシャッターを押した瞬間を`capturedAt`とする。同じシャッター操作の処理で画像フレームを確定し、同じタイミングで単発`getCurrentPosition`を開始する
- `capture`付きfile input fallback: ブラウザが実際のシャッター時刻を保証しないため、fileをアプリが受領した時刻を近似的な`capturedAt`とする。file受領処理と同じタイミングで単発`getCurrentPosition`を開始する

単発位置取得は最大10秒待ち、失敗しても写真を保存する。`location`を省略したPhotoMomentとして扱い、通常GPSの最新値、写真EXIFの時刻・位置、過去のwatch履歴で補完しない。撮影時GPSは写真アンカーと写真間経路のためだけに使い、Liveの展示位置や通常GPS履歴には使わない。

### 8.2 ブラウザ処理

1. `createImageBitmap`または対応する画像デコードで向きを正規化する
2. Canvasで長辺1920px以下へ縮小する
3. JPEGまたはWebPへ再エンコードして新しいBlobを生成する
4. MIME、容量、幅、高さ、SHA-256を計算する
5. 元BlobとEXIFを送らず、加工済みBlobだけをプレビュー・保存・送信する
6. Backendの検証でも形式、寸法、容量、EXIF不在、hashを確認する

初期上限は1セッション12枚、1枚5MB以下、端末の未送信Blob合計30MB以下とする。configが返す値を表示し、Backend制限を超える写真を送らない。

### 8.3 再送状態

```text
processing
  -> ready_to_create
  -> metadata_created
  -> uploading
  -> completing
  -> ready
  -> retry_wait | failed
  -> deleting
```

写真を「思い出へ追加」した時点で、加工済みBlob、撮影時GPS（あれば）、`clientPhotoId`、hash、upload操作の冪等性キーをIndexedDBへ保存する。同時に`localSessionRef`、`localExpiresAt`、`localDeleteAfter`を計算して保存し、期限なしの再送レコードを作らない。メタデータ作成、署名URL PUT、completeを順に行う。

通信断、署名URL期限切れ、429、5xxでは写真だけを再送待ちにする。URL期限切れなら`POST .../upload-url`でURLだけを再発行する。再送は同じ`clientPhotoId`、hash、操作キーを使い、同じPhotoMomentへ収束させる。

再読込時の復旧:

1. `sessionStorage`のMemory credentialを確認する
2. `GET /photos`でサーバーstatusを取得する
3. IndexedDBのclientPhotoIdと照合する
4. サーバーが`ready`なら端末BlobとObject URLを消す
5. サーバーが`pending`でBlobが残っていればupload URLを再発行して再送する
6. サーバーが`pending`でもBlobがなければ再アップロード不能として削除を案内する
7. `failed`は`retryable`/`non-retryable`を表示し、端末Blobを自動削除しない。retryableは再送、non-retryableは端末保存または写真削除を利用者が選べる。選択されない間は上限内で保持し、local expiryで掃除する

サーバーが`ready`または削除済みと確認される前に、成功扱いのBlobを消さない。Backendが検証不合格のobjectを削除しても、端末側の加工済みBlobは独立して保持する。利用者が端末保存または写真削除を確定した時点、またはlocal expiry到達時にだけ端末Blobとプレビューを消してよい。

`ready`画面では「写真が保存されました」と表示する。`failed`画面では再送可能性、端末保存、写真削除を分けて表示し、自動削除済みと誤認させない。写真が`ready`になった後に量子化ピンの反映状態をBackendが返せる場合は、「撮影地点の抽象ピンが展示へ反映されました」と表示するが、原写真・正確な位置・生時刻は表示しない。marker反映statusのresponse fieldは未確定である。

写真上限または容量上限に達したら新規撮影を止め、既存写真の確認・削除・端末保存を案内する。Object URLはコンポーネント終了、写真差し替え、削除で必ずrevokeする。

## 9. 到着、待機、会場内

### 9.1 到着登録

到着タブでQR tokenを一度だけ読み取り、Memory credentialと、存在する場合だけLink credentialを使う。`POST /v1/memory-sessions/{memorySessionId}/arrival`へランダムな`Idempotency-Key`を付ける。二重タップ、再読込、QR再読込では同じキーを再利用し、Backendの既存ArrivalEventへ収束させる。

到着成功時は`arrived`と`queued`を表示する。撮影通知は終了するが、通常GPSは自動停止しない。利用者が「停止」を選ぶか、`on_site`の説明を読んで追加同意した場合にだけ次へ進む。

### 9.2 Memory-only

Memory-onlyでは次を行わない。

- `LivePresenceSession`の作成
- Live participant token、ExperienceLink tokenの保存
- Live用位置permission、`watchPosition`、通常GPS送信
- `trackingStatus=stopped`を代用したLive状態表示

Memory-onlyでは、Memory同意後にユーザーが写真を撮影する操作をした場合だけ、写真アンカー目的の単発`getCurrentPosition`を使ってよい。この位置は写真と一緒に上限付きでIndexedDBへ一時保持・再送するが、Live展示、通常GPS送信、watch履歴には使わない。カメラ拒否、撮影時位置拒否、写真0枚でもMemory参加は継続できる。

Memory-onlyでも位置なしの写真ストーリーと、APIが許可する範囲で到着後の本人用閲覧は成立させる。到着APIでExperienceLinkが省略可能かどうかは現行APIで未確定のため、Backend契約を確定してから実装する。省略不可なら、Memory-onlyの到着フローを暗黙に作らず、受付または代替完了画面へ明示的に落とす。

### 9.3 待機・skip

待機画面はBackendの`queuePosition`、`estimatedWaitSeconds`、`replayStatus`を表示する。タブが非表示のときはpoll間隔を伸ばす。画面はpoll実装に直結せず、将来のSSE等へ差し替え可能な`ArrivalStatusSource`に依存する。

参加者のskip要求には固有の冪等性キーを使う。API仕様に参加者用skip endpointとresponse bodyが未定義なので、実装前に追加する。skip後はキューから除外されたことを状態APIで確認し、待機を続けない。

### 9.4 on_site

`POST /v1/live-presence-sessions/{id}/on-site`へ、追加同意versionと`continue`を送る。

- `continue: false`: Liveを停止し、最新表示位置を消し、`ended`へ進む
- `continue: true`: 追加同意が受理された後だけ`on_site`へ進む
- 表示粒度はBackendの`point | area | interaction_only`を表示し、フロントが勝手に点へ昇格させない

会場内GPSが基準未達なら、エリアまたは操作時表示へ落ちる。到着QRだけで`on_site`にしない。

## 10. 写真ストーリー

`GET /v1/memory-sessions/{id}/memory`で本人用データを取得する。画像URLは5分以内の署名付きURLで、画像URL自体をログ、analytics、Server Component propsへ流さない。期限切れ時はMemory credentialで再取得する。

署名付き画像が期限後も端末や中継に残らないよう、実装前に次のcache契約をBackend、object storage、CDN、Nextの配信設定へ追加する。

- 画像取得responseは`Cache-Control: no-store, private`を必須とし、必要なら`Pragma: no-cache`も付ける
- CDN、リバースプロキシ、画像変換サービスは写真responseを保存・変換・共有せず、署名URLをcache keyやログへ残さない
- Clientの画像取得は`fetch(..., { cache: "no-store" })`相当で行い、取得したBlobのObject URLは表示終了、期限切れ、削除時にrevokeする
- Service Workerは写真responseをcacheしない。MVPでは写真を扱うService Workerを導入せず、将来導入する場合もcache denylistと削除試験を必須にする
- `deleteAfter`や署名URL期限を過ぎた画像を、ブラウザ、Service Worker、CDN、Backendのどこからも再取得できないことを統合試験で確認する

`Cache-Control`やCDN設定が未確定のまま、署名URLの短さだけを期限保証とみなさない。

表示内容:

- 時系列の写真
- 撮影時刻は必要な精度だけ。秒単位の正確な時刻を共有導線へ出さない
- 写真間の再構成経路、`high | medium | low`の信頼度
- 経過時間と「再構成した経路であり実測軌跡ではない」説明
- 場所不明の記憶、未確定区間、写真のpending/failed
- 写真単位削除、Memory全体削除、端末保存

0枚は抽象軌跡、1枚は単独の記憶、2枚以上は写真間のRouteSegmentとして表示する。経路生成失敗時に直線を実歩行として描かない。

## 11. 削除・停止と部分失敗

### 11.1 操作の分離

| 操作 | 消すもの | 消さないもの |
|---|---|---|
| Live停止 | 新しい通常GPS取得・送信、最新表示位置 | Memory、写真、撮影時GPS |
| 写真単位削除 | 写真、加工画像、撮影時GPS、派生特徴、参照経路、端末Blob | 他の写真、Live |
| Memory削除 | Memory、全写真、撮影時GPS、経路、到着、Push、link | Live本体 |
| Live削除 | Live、最新表示位置、Live token、link | Memory、写真 |
| 両方削除 | MemoryとLiveを独立に削除し、linkも削除 | 削除冪等性記録の短期保持は仕様範囲内 |

停止は追跡を止めるだけであり、削除ではない。削除確認では対象範囲、取り消せないこと、サーバー期限削除との違いを明示する。

### 11.2 部分失敗の扱い

両方削除は一つのUI操作でも、BackendではMemoryとLiveを独立に処理する。フロントは次の結果を個別に保持する。

```text
memory: pending | deleted | failed
live:   pending | deleted | failed
link:   active | deleted | unknown
```

片側が成功したら、その側のUIデータと対応credential/keyを成功確認後に消す。Memory削除が成功した場合は写真の端末Blobも利用者の再送対象ではなくなるため消去するが、Live削除成功だけではMemory写真を消さない。もう片側が失敗しても成功側を復活させない。失敗側のcredential/keyだけを同一タブの`sessionStorage`に残し、「未完了のデータだけ再試行」を表示する。両側成功と確認できたら残りのcredential、experience ID、leaseを消す。

削除APIが5xx/timeoutになった場合、削除を未完了として扱い、削除を無制限に自動再試行しない。利用者の再試行操作と期限ジョブに委ねる。403/404はサーバーの削除済み確認か認証失敗かを区別できるAPIエラーコードを要求する。

写真単位削除は`deleting`を表示し、成功確認まで写真を`ready`へ戻さない。前後のRouteSegmentはBackendが残りの写真から再生成するため、フロントで経路を再計算しない。

### 11.3 必要な削除API応答

現行`api.md`には両方削除の部分結果response shapeがない。少なくとも次を返す契約を追加する。

```json
{
  "memory": {"status": "deleted", "retryable": false},
  "live": {"status": "failed", "retryable": true, "code": "TEMPORARY_FAILURE"},
  "experienceLink": {"status": "deleted"}
}
```

status、再試行可否、削除済み側の認証状態が分からないまま、フロントがtokenを全消去したり削除を成功表示したりしてはならない。

## 12. エラーとフォールバック

APIの`{ error: { code, message, requestId } }`を共通`ApiError`へ変換する。`message`をそのまま信頼せず、参加者向け文言をcodeのallowlistで決める。`requestId`だけを問い合わせ用に表示する。

| 状況 | 参加者向け動作 | データ動作 |
|---|---|---|
| config取得失敗/受付停止 | 参加開始不可、案内と再試行 | 権限APIを呼ばない |
| 同意版不一致 | config再取得、変更点を再表示 | 古いtokenを使って作成を続けない |
| カメラ拒否 | 写真なしで継続 | 写真を作成しない |
| 位置拒否/低精度 | Memoryまたは抽象軌跡を案内 | 生位置を取得・保存しない |
| 通信断 | 通常GPSは最新の新規点から、写真は再送待ち | 通常GPSは破棄、写真だけ上限内保持 |
| 429 | `Retry-After`に従って再試行 | 通常GPSの過去点は再送しない |
| 署名URL期限切れ | URL再発行 | 同じPhotoMomentへ再送 |
| 写真検証失敗 | retryable/non-retryableを表示し、再送、端末保存、写真削除を利用者が選ぶ。自動で端末Blobを消さない | 不正objectは削除するが、端末Blob保持とは独立 |
| QR無効/期限切れ/別会場 | 到着登録せず、正しい掲示/受付へ | ArrivalEventを作らない |
| token失効 | 復元不可を表示、権限とwatchを停止 | 対応credentialを消す |
| 描画停止 | 待機、skip、通常展示継続を表示 | 参加者側で描画イベントを再送しない |
| 削除部分失敗 | 成功側は完了、失敗側だけ再試行 | 成功側を復活させない |

## 13. UI、アクセシビリティ、プライバシー

視覚表現は暗い環境で読みやすい高コントラストを基本とし、写真を背景装飾に使わない。参加者の色・記号は色だけに依存せず、形、記号、文言を併用する。

- 主要操作はキーボード、読み上げ、200%拡大で利用可能にする
- タップ領域は44px以上、200%拡大で横スクロールを生じさせない
- 位置状態は`aria-live`で過剰通知せず、30秒経過や停止など意味のある変化だけを通知する
- 削除確認、エラー関連付け、フォーカス移動、見出し階層を明確にする
- `prefers-reduced-motion`では粒子、脈動、強い点滅を静的表現へ置換する
- 日本語と英語の同意、主要操作、エラー、保存期間の意味と情報量を一致させる
- 参加者の氏名、連番、完全なsession ID、歩いた場所の名称を表示しない
- `console`、URL、analytics、クラッシュ報告へtoken、生位置、写真Blob、画像URL、object key、hash、Push endpointを出さない
- XSS対策として第三者スクリプトを置かず、CSP、依存監査、危険なHTML挿入禁止を実施する。同意文は構造化テキスト、またはサーバーで許可要素だけにsanitizeしたものを使う
- Service WorkerとPWAは、通常GPSを永続化しない保証を検証できるまで必須化しない

## 14. API adapterの責務

`src/shared/api`相当のadapterは、UIからHTTP詳細とtokenの取り扱いを隔離する。

- endpointごとに必要なcredentialの型を指定する
- `Idempotency-Key`を操作単位で生成・再利用する
- 位置APIだけは`retryPolicy: neverPersist`とし、失敗候補を破棄する
- 写真APIはclientPhotoId、hash、upload URL期限を扱う
- `401/403/409/413/429/503`をcodeへ変換する
- response schemaと`schemaVersion`を検証し、未知の成功形式をUIへ流さない
- request URL、body、responseへtoken・位置・写真がログされないようにする

フロントで呼ぶAPIの候補は以下である。実装前に未確定項目をAPI文書へ反映する。

```text
GET    /v1/public/config
POST   /v1/experiences
GET    /v1/experiences/{experienceId}
POST   /v1/live-presence-sessions/{id}/position
POST   /v1/live-presence-sessions/{id}/stop
POST   /v1/live-presence-sessions/{id}/on-site
POST   /v1/memory-sessions/{id}/arrival
GET    /v1/memory-sessions/{id}/photos
POST   /v1/memory-sessions/{id}/photos
POST   /v1/memory-sessions/{id}/photos/{photoId}/upload-url
PUT    signed upload URL
POST   /v1/memory-sessions/{id}/photos/{photoId}/complete
DELETE /v1/memory-sessions/{id}/photos/{photoId}
GET    /v1/memory-sessions/{id}/memory
DELETE /v1/memory-sessions/{id}
DELETE /v1/live-presence-sessions/{id}
DELETE /v1/experiences/{id}
```

## 15. テストと受け入れゲート

### Unit / integration

- 同意前にGeolocation、Camera、通知APIが呼ばれない
- Memory-onlyでLiveセッション、Live用位置目的同意、`watchPosition`、通常GPS送信が起きず、Memory同意後の撮影操作では単発`getCurrentPosition`だけが起きる。ブラウザlocation permissionが既許可でもこの結果を変えない
- 位置callbackが多数あっても送信は最新1点だけで、失敗点が永続化されない
- stop/expire/delete後のlate callbackとlate responseが状態を再開しない
- tokenがIndexedDB、localStorage、URL、ログへ出ない
- QR tokenが受信後URLから消え、参加中の所有タブ内で実行するか、外部QRタブからproofだけをBroadcastChannelで渡し、credentialがchannelへ出ない
- 固定channelの偽造・再送、nonce/期限、所有タブ判定、ユーザー確認、proof一回性が機能する
- 外部QRタブ・非所有タブがcleanupを実行せず、所有タブまたはcleanup lease所有タブだけが動く
- 所有タブの再読込・2タブ競合・heartbeat停止を再現し、grace period前に未送信写真を削除しない。owner不在をgrace period後に確定した時だけ孤児掃除する
- 写真の向き補正、EXIF除去、寸法・容量・hash、12枚/30MB上限
- `getUserMedia`のシャッター時刻とfile受領時の近似時刻で、同時点から単発位置取得が始まる
- 写真の同じclientPhotoId/hash/冪等性キーが一つのPhotoMomentへ収束する
- `pending`再読込、URL再発行、ready/削除済み後Blob削除、failedのretryable/non-retryable保持と利用者選択
- Web Locks/BroadcastChannelで二重watch・二重uploadがない
- 到着、停止、削除、skipの再送が冪等である
- 削除部分失敗で完了側が復活せず、失敗側だけ再試行できる
- 到着、停止、skip、削除のキーがsessionStorageに保持され、終端状態確認後に消え、部分削除では失敗側だけが残る。Backendの24時間IdempotencyRecordとclient key保持を別々に検証する
- 同一handoffIdのBroadcastChannel再送でackまで受信し、ownerが重複排除し、ユーザー確認を一度だけ出し、proofを一度だけAPI適用する
- ブラウザlocation permissionが既許可でも、Memory/Liveの目的同意なしに別用途の位置APIを呼ばない
- `ready`後の量子化ピン反映表示と、`on_site`の`point \| area \| interaction_only`表示粒度がBackend/Renderer状態と一致する
- `Cache-Control: no-store`、`fetch`のno-store、Service Worker非cache、CDN非cacheにより期限後の写真取得ができない

### E2E / 実機

- 入口 -> 同意 -> 1枚撮影 -> 通信断 -> 写真再送 -> 最新位置送信 -> 到着 -> 待機 -> 完了 -> Memory閲覧 -> 両方削除
- 写真0枚、カメラ拒否、位置拒否、位置なし撮影
- QRを参加中タブ内で読む、別タブで開く、openerなしで開く
- 再読込、2タブ、QR再読込、画面ロック、アプリ切替、省電力、低速回線
- 同意version変更、期限切れtoken、期限切れupload URL、429、500、部分削除失敗
- Memory-onlyの撮影時GPS許可とLive watch禁止を別々に検証する
- `failed`サーバーobjectの削除後も端末Blobを保持し、retryable/non-retryable、端末保存、写真削除、local expiryを検証する
- iOS Safari、Android Chrome、横/縦写真、前/後カメラ
- キーボード、読み上げ、200%拡大、reduced motion

公開前の必須ゲートは、通常GPSの通信断・再接続検査、写真オブジェクトと端末キャッシュの削除検査、トークンのログ検査、公開描画イベントの原写真/生GPS不在検査、API schema version整合検査とする。

## 16. 主要FRトレーサビリティ

責任欄は、Frontend（F）がブラウザ内で保証すること、Backend（B）がAPI・保存・認証で保証すること、統合が両者の境界で検証することを示す。`未確定`は設計上の暗黙依存を残している項目であり、API契約確定前に完了扱いにしない。

| FR | Frontendの責任 | Backendの責任 | 統合・設計節 |
|---|---|---|---|
| FR-001 | 同意前に権限APIを呼ばず、取得・表示・保存・停止・削除を表示 | 有効な説明・問い合わせ先・保持値を配信 | 6、15、同意E2E |
| FR-002 | 配信versionをそのまま送信し、不一致で再取得 | 有効versionを選び、旧/未知版を拒否 | 6.2、API未確定の同意構造 |
| FR-003 | Memory/Live/Link credentialを分離し、選択しないセッションを作らない | ID・token・同意・認証範囲を分離 | 4、5、6、credential分離E2E |
| FR-004 | 取得中、最終成功時刻、30秒超過、停止を表示 | 最新表示位置のTTLと状態を管理 | 7、15、通信断試験 |
| FR-005 | Live同意後だけwatchし、最新候補を間隔送信 | 位置を検証し量子化済み最新値へ置換 | 7、位置送信統合試験 |
| FR-006 | 通常GPSの失敗点を保存・再送しない | 最新1点のみ受付、履歴を保持しない | 7.1/7.3、通信断E2E |
| FR-007 | stopでwatch・timer・late responseを止める | stop後の位置を拒否し表示位置を消す | 7.1、11.1、stop冪等性 |
| FR-008 | 範囲選択と部分結果を表示しcredential/Blobを適切に掃除 | Memory/Liveを独立削除しlinkを削除 | 11、削除response shapeは未確定 |
| FR-009 | proofをURLから消し、所有タブで冪等到着を実行 | 署名、期限、会場、一回性、linkを検証 | 5.3、9.1、QR API/一回性は要確定 |
| FR-010 | 到着後に停止または追加同意を明示し、自動on_siteにしない | `arrived`/`on_site`/`ended`を遷移 | 9.1/9.4、on_site E2E |
| FR-011 | queue/wait/replayを再読込・再接続後に再表示 | 到着・再生状態を復元可能に返す | 9.3、4.3、response shape一部未確定 |
| FR-012 | aliasの色・記号・文言を併用表示 | 非識別aliasを割り当て、公開情報を制限 | 9.1、13 |
| FR-013 | skip確認と終端表示を行う | 参加者skipを冪等に処理しキュー除外 | 9.3、参加者skip APIは未確定 |
| FR-019 | 日本語/英語の同意・主要操作・エラーを同じ意味で表示 | configの言語・同意版を配信 | 2.3、6、E2E |
| FR-021 | シャッター/受領時刻と単発位置を同時に扱い、EXIFへ依存しない | PhotoMomentと撮影時GPSを別項目で保存 | 6.3、8.1、API検証 |
| FR-022 | 向き補正、EXIF除去、縮小、再エンコード | 保存後にも形式・寸法・EXIFを検証 | 8.2、写真検証E2E |
| FR-023 | 進行/成功/失敗/再送を表示し、`failed`でもretryable/non-retryableと利用者選択またはlocal expiryまで加工済みBlobを保持する | idempotency、pending/ready/failed、URL再発行、不正object削除 | 4.1.1、8.3、5.4、写真再送E2E |
| FR-024 | 撮影時GPSだけをPhotoMomentへ送り、通常GPSを流用しない | CampusGraphで歩行可能経路を再構成 | 8.1、10、経路API/処理はBackend |
| FR-025 | confidenceを正確な実測と誤認させず表示 | `high/medium/low`を判定して返す | 10、経路生成統合試験 |
| FR-026 | Memory credentialでのみ本人ストーリーを取得 | 認証・署名URL・公開不可を保証 | 10、画像cache契約は未確定部分あり |
| FR-027 | 写真単位/全体削除、端末Blob・Object URLを掃除 | 写真、GPS、派生、経路参照、objectを削除 | 4.1.1、11、削除検査 |
| FR-028 | 公開描画へ画像・URL・生GPSを渡さない | 抽象イベントだけを生成 | 3、13、公開イベント検査 |
| FR-029 | カメラ拒否・写真0枚で代替導線を表示 | 写真なしでも到着・抽象軌跡を成立 | 2、9、15 |
| FR-030 | `failed`を含め明示操作で端末保存でき、端末保存後もサーバー期限を延長しない | ダウンロードで`deleteAfter`を延長しない | 8.3、10、保存先/対応ブラウザは未確定 |
| FR-031 | 写真`ready`後に「撮影地点の抽象ピンが展示へ反映された」状態だけを表示し、原写真・正確な位置を表示しない | `photo.marker.created`と量子化座標、TTL、互換versionを生成 | 8.3、marker status fieldは未確定、描画統合 |
| FR-032 | 参加者画面では個人写真の集合数を再構成せず、Backend/Rendererの反映結果だけを表示可能にする | 同一bucket 3件以上のhotspot集計と閾値未満のhidden | Renderer依存、FR-031/32イベント検査 |
| FR-033 | 少人数モードによる個別ピンの遅延・短縮・非表示を参加者へ誤解なく案内する | 閾値、量子化、TTL、sparse modeを適用 | 運用/Renderer依存、閾値未確定 |
| FR-034 | 明示購読・間隔・解除UIを実装する（後続） | Push購読・停止・期限・payloadを管理 | 2.2、18、通知API/公開時期は未確定 |
| FR-035 | 互換version不一致時に位置/ピン/演出を成功表示せず、再試行・更新案内を表示する | coordinate/graph/map versionを検証し不一致イベントを拒否 | Backend/Renderer依存、version response未確定 |
| FR-036 | `on_site`追加同意後、Backendが返す`point \| area \| interaction_only`の表示粒度を画面へ明示する | 用途同意を検証し、精度に応じた粒度を決定 | 9.4、Backend/Renderer接続、field未確定 |

この表の未確定項目は、UI実装で仮responseを作ってMust達成とみなさない。特にFR-008、FR-009、FR-013、FR-026、FR-030、FR-031、FR-032、FR-033、FR-034、FR-035、FR-036はBackend/運用/Renderer契約の確定と統合試験が必要である。

## 17. 実装順序

0. `npm install`等で依存を導入した後、`node_modules/next/dist/docs/`のNext 16.3関連ガイドを読み、AGENTS.mdの指示と実際のインストール内容を照合する。ガイド確認前にコード実装・Next cache/API詳細の確定を行わない
1. `public/config`、入口、言語、同意表示、受付停止
2. Memory/Liveの個別セッション作成、`sessionStorage` credential、復元
3. Server/Client境界、API adapter、state reducer、エラー境界
4. Liveの最新GPS controller、停止、更新停止表示
5. 写真加工、IndexedDBの写真再送、撮影時単発位置、`GET /photos`照合
6. 到着QRのfragment、URL消去、所有タブ内実行/外部proof通知、待機・skip
7. on_site追加同意、Memory-only分岐、写真ストーリー
8. 写真単位/範囲削除、端末期限掃除、部分失敗、アクセシビリティ
9. 画像responseのno-store/CDN/Service Worker非cache確認、実機・負荷・プライバシー検査、必要ならWeb Push/PWA

最初の縦切りは、モックBackendで「同意 -> Memory+Live作成 -> 1枚加工 -> 写真＋撮影時GPSの再送 -> 通信断中の通常GPS破棄 -> 到着 -> 待機 -> Memory表示 -> 部分失敗を含む削除」を通す。Memory-onlyと別タブ到着を同じ縦切りの受け入れ条件に含める。

## 18. 実装前にAPI・運用側で確定する事項

以下はフロントで暗黙に決めてはいけない。

1. `GET /v1/public/config`の同意文をMemory、Live、`on_site`の構造化されたversion/bodyへ分離するか
2. `POST /v1/experiences`でMemory-onlyを表すrequest/response shapeと、Live未作成時の`GET /experiences` schema
3. Memory-onlyの到着で`experienceLinkToken`を省略できるか。省略時のresponse
4. 到着QRのfragment/query形式、queryを採用する場合の全アクセスログredaction
5. 参加者用演出skip endpoint、Idempotency-Key、response body
6. stop、on-site、削除、写真complete、写真memoryの正式response schema
7. 両方削除のセッション別status、再試行可否、削除済みtokenの扱い
8. 写真URL再取得、pendingの期限、photo completeの検証待ちpollまたは状態取得方法
9. `GET /experiences`のalias、queue、replay、photo summary、delete statusの安定schema
10. `point | area | interaction_only`の返却位置と`on_site`追加同意文
11. sessionStorageを使う参加tokenの有効期限、タブhandoffを許可する脅威モデル、openerなしの正式導線
12. 対応OS/ブラウザ最低バージョン、Web Locks非対応時のlease仕様
13. 保存期間、問い合わせ先、未成年条件、外部委託先・保存地域、少人数モードの閾値
14. 現在`node_modules`がないため未確認のNext 16.3同梱ガイド。依存導入後に`node_modules/next/dist/docs/`の関連ガイドを読み、Server/Client、cache、route/API、metadata等の記述を実際の版に合わせて再レビューする
15. 本人用画像responseの`Cache-Control: no-store, private`、CDN/リバースプロキシ非cache、Service Worker非cacheの責任者と検証方法
16. 到着、停止、skip、削除キーのBackend保持期間と、削除partial responseの正式schema
17. QR handoffの`handoffId`/nonce/proof TTL、ack status、再送上限、Backend側proof一回性
18. 写真`ready`後の量子化ピン反映status field、FR-031の参加者向け表示、FR-035の互換version不一致response

現在の作業環境では`node_modules`が存在せず、AGENTS.md指定の同梱ガイドは未確認である。これはコード実装前のゲートであり、Nextの既知知識だけでcache/API詳細を確定しない。これらが未確定のままでは、UIモックは作れても、同意、Memory-only、別タブ、削除、プライバシー要件を満たす本実装の完了とはみなさない。
