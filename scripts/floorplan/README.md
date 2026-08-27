# Floorplan asset pipeline (豊洲キャンパス複数棟 3Dマップ用)

`config.json` の `buildings` に列挙した4棟のフロアテクスチャと生成ジオメトリを、
キャンパスダイアリー2026の PDF から再生成するパイプライン。
設計の背景は `docs/floor-map-3d.md` を参照。

## 入力素材(リポジトリ外・ローカル保持)

| ファイル | 説明 | SHA256 |
|---|---|---|
| `tmp/pdfs/campus-diary-2026-2.pdf` | キャンパスダイアリー2026(24MB)。ページ58〜72が対象棟の階別図(58が本部棟B1F、59以降が1F〜14F) | `dd7db3837c01ab0eeb0fa3a1667e82841f5d78d53b7b043f4f82fea4ada03318` |

PDF が無い環境では、レンダ済み `scripts/floorplan/debug/render/page-*-600dpi.png`
があればそこから続行できる(`render` ステージは自動でフォールバック)。

## 実行

```bash
python scripts/floorplan/build.py --debug
```

- 依存: Python 3.11+ / Pillow / numpy / opencv-python / PyMuPDF
- `--debug` で `debug/{building-id}/` に棟別の検証画像を出力(gitignore 済み)
- `--stage render|register|crop|coverage|walls|emit` で途中まで実行

## ステージ

1. **render** — 各棟の `pages` で指定した PDF ページを 600dpi で PNG レンダ(キャッシュあり)
2. **register** — 各棟のフロアページをその棟の `referenceFloor` へ位置合わせ。
   階段コアのテンプレート群(`config.json` の `templates`)をマッチし、
   2枚以上が±48px内で合意するシフトクラスタを採用 → 共有構造ウィンドウ
   (`refineWindow`)の位相相関で精補正。ページ装飾(帯・タブ・凡例)が
   全ページ同位置にあるため、全面相関は使わない
   テンプレートが2枚以上合意するクラスタを作れない場合は停止する。
3. **crop** — 棟ごとに基準ページ座標で1つだけ定義した `masterRect` を、各フロアの
   シフト分ずらして切り出す(全フロアが同一座標系・同一アスペクトを共有)。
   宙に浮く注記テキスト・引出線は `eraserRects`(マスター座標)で白塗り。
   シアンの長い建物線が切り出し端に触れた場合は矩形不足として警告する
4. **coverage** — ページ装飾を除くシアンインクが全棟の `masterRect` の外へ
   落ちていないかをゲートする。許容は `coverage.pageMaxUncoveredPx`(現在100px)。
   以前の2000pxでは、東側連絡通路(1ページあたり約450px)が棟ごと config から
   落ちても全ページ PASS のままだった。意図的な未収録は
   `coverage.acceptedGaps` に理由付きで明示する。さらに各棟・各階のフットプリント外インク率を警告する。
   標準出力と `debug/coverage/report.md` にページ表・フロア表を出力し、失敗ページは
   未収録インクを赤、マスター矩形を青で `debug/coverage/page-{n}.png` に重畳する
5. **walls** — `featuresJson` の自階エスカレーター・下階から到達する
   エスカレーター矩形を先にマスクから除外する。階段の短い踏段線は通常の
   最小ラン判定で落ちるため、実壁を分断する広域マスクは掛けない。その後、シアンインクの
   小成分(文字・記号・破線)を除去し、
   方向別クローズ→オープンで長い直線ストロークだけ残し、連結成分ごとに
   1本の中心線セグメントへ。マスター矩形基準で±0.5に正規化
6. **emit** — インクの濃さはアルファ、色相は彩度に比例して保持、明度は
   `texture.inkValue` の一定値(ビューアのブルーム閾値より下)。この3つを
   分けないと、図面で最も濃い黒文字が薄く、グレーのピクトグラム地が最も
   明るく出るという濃淡の逆転が起きる。PNGテクスチャと、生成パラメータ・入力SHA256入りの
   ジオメトリ JSON を出力(完全再現可能)。元の600dpi座標はジオメトリ用に保持しつつ、
   GPUへ展開する全棟のテクスチャを `texture.texelsPerMasterPx` の共通比率で縮小する

新しい棟を初回生成するときは、縦動線アノテーションがまだ無いため図面記号が
仮の壁として残る。`stairs` / `escalators` を実測して `featuresJson` に追加した後、
必ず再生成し、壁重畳プレビューで記号線が消えたことを確認する。

## 検証(--debug の出力)

- `debug/{building-id}/overlay-registration.png` — その棟の全フロアを色分け重畳。
  共有構造(外周壁・階段・EV)が白=全フロア一致なら合格
- `debug/{building-id}/crop-*.png` — 切り出し結果(=テクスチャ内容)
- `debug/{building-id}/walls-over-texture-*.png` — 抽出壁(赤)をテクスチャに重畳。
  赤線が図面の壁上にのみ乗っていること

階段記号の細線が壁として残る場合は、その階段だけ `wallMask` を指定して抽出対象から
除外する。マスクは階段矩形の内側へ絞り、隣接する実壁を消さないこと。

## パラメータを調整したら

`config.json` の共有パラメータまたは `buildings` 内の棟別設定を編集 → `--debug` で
再実行 → 上記画像を目視 → 問題なければ各棟の `output` で指定した生成物をコミット。
