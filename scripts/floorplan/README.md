# Floorplan asset pipeline (教室棟 3Dマップ用)

`public/floorplans/classroom/floor-{1..6}.png`、
`src/lib/map/toyosu-classroom.generated.json`、参照階から自動トレースする
`src/lib/map/toyosu-context.generated.json` を、キャンパスダイアリー2026の
PDF から再生成するパイプライン。設計の背景は `docs/floor-map-3d.md` を参照。

## 入力素材(リポジトリ外・ローカル保持)

| ファイル | 説明 | SHA256 |
|---|---|---|
| `tmp/pdfs/campus-diary-2026-2.pdf` | キャンパスダイアリー2026(24MB)。ページ59〜64が教室棟1F〜6F | `dd7db3837c01ab0eeb0fa3a1667e82841f5d78d53b7b043f4f82fea4ada03318` |

PDF が無い環境では、レンダ済み `scripts/floorplan/debug/render/page-{59..64}-600dpi.png`
があればそこから続行できる(`render` ステージは自動でフォールバック)。

## 実行

```bash
python scripts/floorplan/build.py --debug
```

- 依存: Python 3.11+ / Pillow / numpy / opencv-python / PyMuPDF
- `--debug` で `debug/` に検証画像を出力(gitignore 済み)
- `--stage render|register|crop|context|walls|emit` で途中まで実行

## ステージ

1. **render** — PDF ページ59〜64を 600dpi で PNG レンダ(キャッシュあり)
2. **register** — 各フロアページを基準フロア(3F)へ位置合わせ。
   階段コアのテンプレート群(`config.json` の `templates`)をマッチし、
   2枚以上が±48px内で合意するシフトクラスタを採用 → 共有構造ウィンドウ
   (`refineWindow`)の位相相関で精補正。ページ装飾(帯・タブ・凡例)が
   全ページ同位置にあるため、全面相関は使わない
3. **crop** — 基準ページ座標で1つだけ定義した `masterRect` を、各フロアの
   シフト分ずらして切り出す(全フロアが同一座標系・同一アスペクトを共有)。
   宙に浮く注記テキスト・引出線は `eraserRects`(マスター座標)で白塗り。
   `contextRect` は参照階(3F)の1枚だけから切り出し、壁抽出には渡さない
4. **context** — 参照階コンテキストのシアン線を閉じ、連結した棟外形を
   多角形化。手書きの棟ID・名称・階数・内部点と対応させて生成JSONへ出力
5. **walls** — シアンインクのマスクから小成分(文字・記号・破線)を除去後、
   方向別クローズ→オープンで長い直線ストロークだけ残し、連結成分ごとに
   1本の中心線セグメントへ。マスター矩形基準で±0.5に正規化
6. **emit** — パレットPNGテクスチャと、生成パラメータ・入力SHA256入りの
   ジオメトリ JSON を出力(完全再現可能)

## 検証(--debug の出力)

- `debug/overlay-registration.png` — 6フロアのマスクを色分け重畳。
  共有構造(外周壁・階段・EV)が白=全フロア一致なら合格
- `debug/crop-{1..6}.png` — 切り出し結果(=テクスチャ内容)
- `debug/context.png` — 参照階だけから切り出した周辺キャンパス範囲
- `debug/context-mask.png` / `debug/context-features.png` — 輪郭抽出用マスク / トレース結果の重畳
- `debug/walls-over-texture-{1..6}.png` — 抽出壁(赤)をテクスチャに重畳。
  赤線が図面の壁上にのみ乗っていること

## パラメータを調整したら

`config.json` を編集 → `--debug` で再実行 → 上記3種の画像を目視 →
問題なければ生成物(`public/floorplans/classroom/`、
`src/lib/map/toyosu-classroom.generated.json`、`src/lib/map/toyosu-context.generated.json`)をコミット。
