# TRACE Frontend

TRACE の参加者向け Web App 用フロントエンドです。現在は開発環境と、元企画資料に基づくフロントエンド設計を含みます。

現在のアプリは、参加者向けのブラウザ内モック実装です。Go BackendへのHTTP接続はまだ行わず、`TraceApi` interfaceのデフォルト実装である`MockTraceApi`が、同意・撮影・GPS・到着・待機演出・Memory・削除の導線を再現します。

## 設計

- [参加者向けフロントエンド設計](docs/frontend-design.md)

API・運用側で確定が必要な契約は、設計書の「実装前にAPI・運用側で確定する事項」を参照してください。

## 開発を始める

```bash
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

### デモ導線

1. `/consent`で写真Memory、撮影時の単発位置、Live位置を目的別に個別選択
2. `/experience`で写真を撮影（加工済みJPEGをIndexedDBへ保存）し、明示操作でLive位置を開始・停止
3. `/arrival#checkpointToken=demo-arrival`を開くか、画面の「デモ到着を試す」から到着登録
4. `/arrival/waiting`で待機・再生・スキップと、到着後のLive停止／会場内モードを確認
5. `/memory`で写真ストーリー、写真削除、端末保存を確認
6. `/settings/data`でMemory／Live／両方の削除を確認。「次回Live失敗を再現」を先に押すと部分失敗とLive側だけの再試行状態を確認できます

カメラや位置情報を許可できない場合は`/alternative`を利用できます。`MockTraceApi`自体はcredentialを永続化せず、非機密のsnapshot・デモ失敗フラグ・写真tombstoneだけを同一タブの`sessionStorage`へ保存します。一方、Providerは参加者credentialと目的別同意状態を同一タブの`sessionStorage`へ保存し、再読み込みで復元します。期限切れ・壊れた保存値は破棄して未参加扱いにします。外部QRタブからのhandoffは、handoffId/nonce/TTL/ack/owner確認とBackendのproof一回性契約が確定するまで有効化しません。同一タブのfragmentからのデモ到着登録は利用できます。実運用のGo Backend、認証、署名URL、会場の描画クライアントは未接続です。

## コマンド

- `npm run dev`: 開発サーバー
- `npm run build`: 本番ビルド
- `npm run start`: 本番サーバー
- `npm run lint`: ESLint

## 構成

- Next.js App Router
- React / TypeScript
- Tailwind CSS
- ESLint
