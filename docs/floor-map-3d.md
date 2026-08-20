# 教室棟 3Dフロアマップ 設計書

対象: `/map`(豊洲キャンパス教室棟の3Dフロアビュー)
関連: アセット生成は [scripts/floorplan/README.md](../scripts/floorplan/README.md)、参加者向けアプリ全体は [frontend-design.md](./frontend-design.md)

構成: **§1〜§8 = v1**(座標系の一元化・非React ビューア・壁抽出)、**§9〜§18 = v2**
(立体要素・フライ操作・レンダリングパイプライン)。v2 は v1 の不変条件を壊さずに
積み増す設計になっている。

## 1. 目的と範囲

- 芝浦工業大学 豊洲キャンパス **教室棟(1〜6F)** の公式フロア案内図
  (キャンパスダイアリー2026)を、階の積層として立体的に閲覧する静的ビュー。
- **表示するのは建物情報のみ**。参加者の現在地・ピン・経路・Live情報は
  一切扱わない。これは `frontend-design.md` の「参加端末で地図上の生位置を
  再構成しない」という制約に対する意図的な設計であり、`/map` は
  `experience-provider` の状態(セッション・同意・写真)から完全に独立する。
- 対象は教室棟1棟のみ。ただしデータモデルは複数棟に拡張可能な形にしてある
  (§4)。教室棟ストリップと4F以上で接続する南側ウィング(3Fではカフェテリア棟)は
  フットプリントが階ごとに異なるため対象外とし、必要になったら別棟として追加する。

## 2. アセットパイプライン

生成物はすべて `python scripts/floorplan/build.py` で PDF から再現できる。
手順・パラメータ・検証画像は `scripts/floorplan/README.md` を参照。
設計上の要点だけ記す。

### 2.1 入力と前提(実測に基づく)

- キャンパスダイアリー2026のページ59〜64が教室棟1F〜6F。1ページに
  **複数棟の図面が同居**しており(3Fページなら教室棟・研究棟・カフェテリア棟・
  2300番台教室棟)、教室棟だけを切り出す必要がある。
- 全ページ同一縮尺・回転なし。ページ間の差は**平行移動のみ**
  (実測: 2Fのみ約-180px、他は±10px以内 @600dpi)。
- 1F・2Fは各棟が地上で連結した複合図面で、教室棟以外との共有構造が少ない。
  さらに階段コアも階によって異なる(1Fは玄関階でツイン階段が無い、2Fは
  ツイン階段の位置が異なる)。

### 2.2 レジストレーション(位置合わせ)

旧実装の「ずれ」の根本原因は、目分量のクロップ矩形と検証不能な手動補正
(`planOffsetX`)だった。作り直しでは:

1. **階段コアのテンプレート群**(最下部階段・ツイン階段・最上部階段、
   基準3Fページ座標)を各ページにマッチし、上位ピークのうち
   **2枚以上のテンプレートが±48px内で合意するシフトクラスタ**を採用する。
   他棟の類似階段は単独ピークにしかならずクラスタを作れない。
   一部の階に存在しないコアがあっても、残りのコアで合意できる。
2. 共有構造(外周壁・コア)を含む固定サブウィンドウの**位相相関**で
   数pxの残差を precise に吸収する。

全面相関を使わないのは、ページ装飾(帯・タブ列・記号凡例)が全ページ同一
位置に印刷されており、相関がそちらに引き寄せられて壊れるため(実測済み)。

検証は `debug/overlay-registration.png`(6フロアのインクを色分け重畳)で行い、
共有構造が白(=全フロア一致)なら合格。手動の逃げ道として
`manualShiftOverride` を config に用意している。

### 2.3 クロップと消しゴム

- **マスター矩形を基準ページ座標で1つだけ定義**し、各フロアは
  「矩形+そのフロアのシフト」で切る。全フロアが同一座標系・同一アスペクトを
  共有するため、クロップ精度が座標データに焼き込まれる旧欠陥は構造的に
  起こらない。
- 矩形内に残る宙に浮いた注記(引出線先の説明テキスト等)は、マスター座標系の
  `eraserRects`(全フロア共通+フロア別)で白塗りする。**建物と地続きの
  実構造(1F/2Fの連結部)は公式図面の実態なので消さない**。

### 2.4 壁抽出

シアンインク(図面の描画色)のマスクから:

1. 小さな連結成分(文字・記号・破線の各ダッシュ)を先に除去
   — 破線が後段のギャップ連結で偽壁に化けるのを防ぐ順序が重要
2. 方向別のクローズ(≤12px のギャップ連結)→ オープン(≥50px のランのみ残す)
3. 残った成分1つ = 壁1本として bbox 中心線をセグメント化、近接平行線は統合
4. **マスター矩形基準で ±0.5 に正規化**(テクスチャと同一座標系)

結果: フロアあたり83〜100本(旧実装は326〜426本、うち約15%がゴミ・37%が微小スタブ)。

### 2.5 テクスチャ

600dpi でレンダし 912×1514px(旧520×1000の約2倍解像度)。白紙をアルファに、
インクを明色化した**透過ブループリンナー調 RGBA PNG** として出力する。
ダークテーマの3Dステージ上で、不透明な白いカードではなく発光する線画として
読めるようにするため。

## 3. 座標系とスケール

正規化平面座標(±0.5、+z=図面の下方向)→ ワールド座標の変換は
`src/lib/map/plan-transform.ts` の **1箇所だけ**に存在し、平面図テクスチャ・
スラブ・壁がすべて同じ変換を通る。旧実装の「テクスチャ0.98倍 vs 壁1.0倍」
「4つの無関係なマジックナンバーによる18.8%の歪み」のような、描画物ごとの
スケール乖離は型レベルで起こらない。

- ワールド幅は 6 に固定し、奥行きはテクスチャ実寸比から導出(≈9.96)
- 階高 `LEVEL_HEIGHT = 0.42`、壁高 0.3、壁厚 0.045(視認性優先の誇張値)

## 4. データモデル(`src/lib/map/`)

```
toyosu-classroom.generated.json  … 生成物(ジオメトリ+生成パラメータ)
types.ts                         … 型定義
buildings.ts                     … 人手メタ(和文タイトル・室名)+棟レジストリ
```

- **生成物と人手データを分離**: 室名や階タイトルは `buildings.ts` にあり、
  アセットを再生成しても消えない。ローダーがフロアIDで結合し、不一致は
  モジュール初期化時に throw する(ビルドで検出)。
- 生成JSONには schemaVersion・生成パラメータ・入力PDFのSHA256・シフト表が
  同梱され、完全に再現可能。fetch ではなく**静的 import** で読むため、
  旧実装の「fetch と GL 破棄のレース」は存在しない。
- 複数棟拡張: `buildings.ts` の配列に `BuildingDefinition` を足すだけで、
  ビューアは棟定義しか見ない。

## 5. ビューア構成

```
src/app/map/page.tsx                    … Suspense ラッパー(useSearchParams 用)
src/components/map/map-screen.tsx       … UIシェル(React状態の所有者)
src/components/map/floor-map-canvas.tsx … <div ref> だけの薄いブリッジ
src/lib/map/floor-map-viewer.ts         … ★React非依存の three.js ビューアクラス
src/lib/map/build-floor-group.ts        … フロア1枚分のシーングラフ構築
src/lib/map/plan-transform.ts           … 座標変換(§3)
```

### 5.1 ライフサイクル — 「初期化1回・命令的更新」

`FloorMapViewer` はキャンバスの生存期間に1回だけ構築される。React 側の
useEffect は「初期化」「フロア選択」「カメラモード」「debugStack」に分割され、
状態変更は `setSelectedFloor()` / `setCameraMode()` の呼び出しに変換される。
これらは**マテリアルの不透明度とグループ位置を書き換えるだけ**で、
ジオメトリ・シェーダ・テクスチャ・GLコンテキストには触れない。
旧実装の「フロアを切り替えるたびに全GL資源を破棄・再構築」は構造的に不可能。

- テクスチャロードは viewer 内の `disposed` フラグでガード(破棄後の
  onLoad を無視)
- `dispose()` は rAF・ResizeObserver・controls・全 geometry/material/texture・
  renderer・canvas を確実に解放
- レンダループは rAF 常駐だが `needsRender` フラグと OrbitControls の
  変化通知がない限り `render()` をスキップ(静的ページとして省電力)

### 5.2 シーングラフ

フロアごとに `THREE.Group`:

- スラブ(薄い BoxGeometry、ミント透過)
- 平面図(PlaneGeometry + MeshBasicMaterial。照明非依存で常に読める。
  sRGB・anisotropy・polygonOffset 設定済み)
- 壁(全セグメントを `mergeGeometries` で**1フロア1ドローコール**に統合。
  MeshLambertMaterial ミント)

選択状態は3段階の不透明度プリセット(selected / dimmed / all)+選択フロアの
持ち上げ(+0.09)。ライトは HemisphereLight + DirectionalLight 各1灯のみ。

### 5.3 カメラ

OrbitControls(damping、距離3.5〜30、極角≤1.35 で常に上から見る)。
NORTH は建物直上からの真下視点(図面の上=画面の上)。WASD 移動は廃止し、
右ドラッグのパンで代替。

## 6. UI仕様

- フロアセレクタ: ALL / 1F〜6F。選択フロアを強調し他階を減光
- カメラ: ORBIT(自由回転)/ NORTH(真上)
- **ディープリンク**: `/map?floor=3`(`all` | `1`..`6`)。読み取りは
  `useSearchParams`(page.tsx の Suspense 境界内)、書き込みは
  `history.replaceState`(サーバー再レンダなし)
- インスペクタ: 選択フロアの公式2D図面(実アスペクト比)・階タイトル・室名タグ
- 開発時のみ: `?debug=stack` で全フロアを同一高さに重ねるアライメント検証
  モード、`window.__traceFloorMapViewer` にビューアを公開

## 7. 検証手順

アセット側(パイプライン実行後):

1. `debug/overlay-registration.png` — 共有構造が白(全フロア一致)
2. `debug/walls-over-texture-{1..6}.png` — 赤線が図面の壁上にのみ乗る

アプリ側:

1. `npm run dev` → `/map` で目視。フロア/カメラ切替を10回以上行っても
   canvas 要素と GL コンテキストが同一のままであること
   (dev console: `document.querySelector(".campus-3d-canvas")` の同一性)
2. NORTH + ALL(+ `?debug=stack`)で全フロアを重畳し、外周・コアが
   一本の線に見えること(階間ずれの回帰チェック)
3. テクスチャ端と壁の一致、`?floor=` の読み書き、リサイズ・モバイル幅
4. `npx tsc --noEmit` / `npx eslint .` / `npm run build` がクリーン。
   three.js は `/map` ルートの import グラフに閉じている

## 8. 既知の制限と今後の拡張

- 斜め壁・曲面壁(1Fエントランスの曲線等)は壁抽出の対象外
  (テクスチャには写る)。必要なら抽出器に斜線検出を足す
- 4F以上の南側ウィング(401/402教室等)は対象外(§1)。追加する場合は
  別棟としてマスター矩形をもう1つ定義する
- ~~階段・EV・エスカレーターの立体表現は図面テクスチャに委ねている~~
  → **v2 で解消**。パイプラインでの自動抽出ではなく、検証ツール付きの手動
  アノテーションで定義する(理由は §10.1、実装は §12)
- 一次入力の PDF はリポジトリに含めない(24MB)。SHA256 を生成メタデータと
  `scripts/floorplan/README.md` に記録してある

---

# v2 — 操作性・立体要素・ビジュアル品質

§1〜§8 が v1(切り出し精度と非React ビューアの確立)。v2 はその構造を壊さずに
積み増す。v1 の不変条件 —— **マスター座標系は1つ / 変換は `plan-transform.ts`
だけ / GL資源は再生成しない** —— は v2 でも維持し、新要素はすべてこの3点の内側に
収める。

## 9. v2 の狙いと非目標

v1 は「正しい」が「立体ではない」。積層した6枚のガラス板の上に線画が乗っている
状態で、次の4点が弱い。

| 弱点 | v2 での解決 |
|---|---|
| 床と吹き抜けの区別がつかない(全面がのっぺりした板) | §11 フットプリント形状のスラブ + 開口 |
| 階段・EV・エスカレーターが図面記号のまま(平面) | §12 縦動線の立体化 |
| 教室が空箱で、スケール感が無い | §13 什器(机・ホワイトボード)の薄い配置 |
| 見た目が「線画の重ね合わせ」で3DCGに見えない / 移動が窮屈 | §14 フライ操作、§15 レンダリングパイプライン |

**非目標**: 現実の座席数・什器配置の再現、斜め壁・曲面壁の立体化、教室棟以外の棟。
什器は寸法感を与えるための概略表現であって実測データではない(§18・§13.4)。

## 10. 手動アノテーション —— `toyosu-classroom.features.json`

### 10.1 なぜ自動抽出しないか

v1 の壁抽出(§2.4)は「長い直線ストローク」という**単一の性質**を全図面に一様に
適用できたから成立した。縦動線は逆で、記号ごとに形が違う。

| 図面記号(実測) | 意味 | 自動検出の困難 |
|---|---|---|
| 密な平行短線のハッチ矩形 | 階段(踏面) | ハッチはv1の壁抽出が「小成分」として捨てる対象。復活させると文字も戻る |
| 細長い帯2本組 + 矢印 | エスカレーター(上り/下りペア) | 壁の細長い矩形と形状が同じ。矢印の有無でしか区別できない |
| 一点鎖線のバッテン(X) | 吹き抜け | 破線ダッシュ列。v1が最初に除去する対象そのもの |
| 「EV」ラベル + 矩形 | エレベーター | 文字認識が必要 |

一方で**数が少ない**。1フロアあたり階段3〜4・エスカレーター1〜2・EV 1・
吹き抜け0〜2、6フロアで合計50件程度。しかも全フロアが単一のマスター座標系を
共有しているため(§2.3)、**一度実測すれば全フロアで座標が通用する**。
自動検出器を書いて壊れ方を追いかけるより、実測して検証ツールで潰すほうが速く、
壊れない。

ただし手作業は「検証できない手作業」になった瞬間に v1 が廃した `planOffsetX` と
同じ罠になる。**検証ツール(§10.5)とセットでしか導入しない**。

### 10.2 座標系 —— マスター矩形ピクセル

アノテーションは**マスター矩形のピクセル座標**(原点=切り出し左上、912×1514、
+y = 図面の下)で書く。正規化値(±0.5)を人手で書かないのは、実測手段が
`debug/crop-{floor}.png` を画像ビューアで開いてカーソル座標を読むことだからで、
測った数字をそのまま書ける形が唯一ミスの入らない形になる。
`config.json` の `eraserRects` と同じ空間なので、既存の作業と地続きでもある。

ピクセル→正規化の変換は `plan-transform.ts` に1関数だけ足す。
v1 の「変換は1ファイルに閉じる」を文字通り維持する。

```ts
// plan-transform.ts
export function planPxToNormalized(px: number, py: number, plan: BuildingPlan) {
  return { nx: px / plan.widthPx - 0.5, nz: py / plan.heightPx - 0.5 };
}
```

矩形は `[x0, y0, x1, y1]` の2隅タプルで持つ(`eraserRects` の `{x,y,w,h}` とは
あえて変える)。画像ビューアで2点読むだけで書け、幅・高さの引き算という
人間の誤りどころを消せるため。この差異は §10.3 のスキーマコメントに明記する。

### 10.3 スキーマ

`src/lib/map/toyosu-classroom.features.json` —— **手動保守。生成物ではない**
(`*.generated.json` と名前で区別する)。

```jsonc
{
  "schemaVersion": 1,
  "buildingId": "toyosu-classroom",
  "coordinateSpace": "master-rect-px",   // 912 x 1514, 原点=切り出し左上, +y=図面下
  "rectFormat": "x0,y0,x1,y1",

  // 建物外形。2〜6Fは同形なので default、1Fだけ個別に持つ
  "footprints": {
    "default": [[30, 288], [268, 288], [268, 378], "..."],
    "1":       [[68, 285], "..."]
  },

  // 建物レベル(フロアに属さない)
  "elevators": [
    { "id": "ev-north", "rect": [812, 300, 912, 396], "levels": [1, 6] }
  ],

  "floors": {
    "3": {
      "voids": [
        { "rect": [318, 928, 478, 1222], "kind": "atrium" }
      ],
      "stairs": [
        { "id": "st-nw", "rect": [95, 292, 197, 356], "up": "+x" },
        { "id": "st-n",  "rect": [470, 222, 520, 272], "up": "-z" },
        { "id": "st-e",  "rect": [778, 455, 832, 512], "up": "-z" },
        { "id": "st-sw", "rect": [95, 1438, 197, 1496], "up": "+x" }
      ],
      "escalators": [
        { "id": "es-n", "rect": [320, 685, 386, 845],  "up": "-z", "lanes": 2 },
        { "id": "es-s", "rect": [318, 905, 386, 1062], "up": "-z", "lanes": 2 }
      ],
      "classrooms": [
        { "x": [33, 268], "rows": [[378, 530], [530, 705]], "facing": "-z" }
      ]
    }
  }
}
```

- `up` は**昇る向き**を平面軸で表す(`"+x" | "-x" | "+z" | "-z"`、+z = 図面の下)。
  階段ハッチの線の向きから読める(踏面線に直交する向きが昇降方向)
- `voids[].kind` は `"atrium" | "escalator-well" | "stair-well"`。ジオメトリには
  影響せず、凡例と縁の色分けにだけ使う
- `classrooms` は**帯状に並ぶ教室列**を1エントリで表す。左帯のように x が共通で
  y だけ仕切られる並びが支配的なので、`x` を1回・`rows` を室数分書けば済む。
  `facing` はホワイトボードを付ける面(既定 `-z` = 図面の上 = 北)
- 上の座標は `debug/crop-3.png` からの**暫定実測値**。実装時に §10.5 で追い込む

### 10.4 ローダーと検証

`src/lib/map/features.ts` が JSON を読み、正規化して `BuildingDefinition` に結合する
(`buildings.ts` が `buildFloors()` でメタを結合しているのと同じ流儀)。
**モジュール初期化時に throw する不整合**:

- `buildingId` / `schemaVersion` の不一致
- 生成JSONに存在しないフロアIDのエントリ
- マスター矩形をはみ出す矩形、`x0 >= x1` / `y0 >= y1`
- 3点未満のフットプリント
- `elevators[].levels` が実在階の範囲外

v1 の「不一致はモジュール初期化時に throw する(ビルドで検出)」(§4)と同じ扱いで、
アノテーションのタイポが本番に出ることはない。

型は `types.ts` に置き、`BuildingDefinition` を拡張する:

```ts
export interface BuildingFeatures { footprint: Vec2[]; elevators: ElevatorShaft[]; }
export interface FloorFeatures { voids: Void[]; stairs: Stair[]; escalators: Escalator[]; classrooms: ClassroomRow[]; }
// BuildingFloor に features?: FloorFeatures、BuildingDefinition に features: BuildingFeatures
```

座標は**この時点で正規化済み**(±0.5)にして返す。ビューア側はピクセルを知らない。

### 10.5 検証ツール `scripts/floorplan/preview_features.py`

アノテーションのずれを、3Dに持ち込む前に2Dで潰す。

```bash
python scripts/floorplan/preview_features.py --floor 3
```

- 入力: `src/lib/map/toyosu-classroom.features.json` と `debug/crop-{floor}.png`
- 出力: `debug/features-{floor}.png` —— crop に半透明で色分け重畳
  - フットプリント = 白の輪郭 / 吹き抜け = 赤の塗り + X / 階段 = 黄 + 昇降方向の矢印
  - エスカレーター = 橙 + レーン分割線 / EV = 青 / 教室 = 緑の枠 + 北面の太線
- `build.py` のステージには**組み込まない**。features.json はパイプラインの
  生成物ではなく、パイプラインの再実行で壊れも直りもしないため。
  `pipeline/common.py` の `load_config` / `DEBUG_DIR` だけ再利用する

**合格条件**: 黄がハッチ矩形に、橙が矢印付きの帯に、赤が一点鎖線のXに、
青が EV 枠に、緑の北面線が各教室の上端の壁に、それぞれ ±5px で乗ること。
ここが合わない状態で実装に進まない。

## 11. スラブ = フットプリント + 開口

「床と吹き抜けの区別がつかない」の根治。マスター矩形全面の `BoxGeometry` を捨て、
建物外形から開口を抜いた形にする。

### 11.1 ジオメトリ

```ts
const shape = new THREE.Shape(footprint.map(([nx, nz]) =>
  new THREE.Vector2(toWorldX(nx, t), toWorldZ(nz, t))));
for (const v of voids) shape.holes.push(new THREE.Path(rectPoints(v)));
const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB_THICKNESS, bevelEnabled: false });
geo.rotateX(Math.PI / 2);
```

`THREE.Shape` は XY 平面・押し出しは +Z。`rotateX(+π/2)` は
`(x, y, 0) → (x, 0, y)` かつ押し出し方向 `+z → -y` に写るので、
**平面の y がそのまま world z(+z = 図面の下、v1 と同符号)になり、
スラブは y ∈ [-SLAB_THICKNESS, 0] を占める** —— v1 の
`slab.position.y = -SLAB_THICKNESS/2` と完全に同じ位置。追加の平行移動は要らない。
穴(`holes`)の巻き順は問わない —— `ExtrudeGeometry` が `ShapeUtils.isClockWise` で
輪郭を時計回りに正規化し、その際に穴を反対回りへ揃える(実装確認済み)。

### 11.2 縁の線 —— フットプリント外周のみ(改訂)

**当初案(開口の縁を白 `#d8fff0` / opacity 1.0 で光らせ、ブルーム閾値を越える
唯一の線にする)は撤回した。** 実装して見ると、画面上でいちばん明るいものが
「床が無い場所」になり、視線が不在の方へ引かれる。吹き抜けの読み分けは
スラブの切り口そのものに任せ、線は残さない。

y=0 に置く `LineSegments` はフットプリント外周のみ(ミント `#8de4c4` / opacity 0.55)。

`EdgesGeometry(slabGeo)` は使わない。三角形分割由来の対角線が混ざるうえ、
押し出し側面の縦エッジまで出て線が濁るため、アノテーションのポリラインから
直接組む。

### 11.3 平面図テクスチャも同形に切る(改訂)

**当初案(テクスチャ平面には穴を開けない)は撤回した。** 開口部にも X 印
(一点鎖線)が印刷されているため、全面の平面を敷くと X が穴の上に浮き、
**吹き抜け=「X が描かれた床がある所」/ 実際の床=「何も無い所」という
真逆の読まれ方**になる。テクスチャシートも `ShapeGeometry` で
フットプリント−開口の形に切り、UV は world XZ から
`u = x/width + 0.5`, `v = 0.5 − z/depth` で直に張る(全面平面と同一の対応)。
X 印は図面の証拠として残るが、床のある所にしか出ない。

### 11.4 renderOrder の整理

要素が増えるので、v1 の `level * 3 + n` を階層化する。

```
base = level * 10
 +0 スラブ   +1 平面図   +2 壁   +3 縦動線・什器   +4 輪郭・開口縁
EVシャフト(建物レベル) = 100
```

## 12. 縦動線の立体化

フロアごとに `stairs + escalators + desks` を**1つの `BufferGeometry` に
`mergeGeometries` でまとめる**(v1 の壁と同じ方針、ドローコール数を増やさない)。
マテリアルは半透明のミントで、図面の線を潰さない。

### 12.1 階段

アノテーション矩形の中に `STEPS = 12` 段。`up` 軸方向に矩形を12等分し、
i 番目は高さ `(i + 1) * LEVEL_HEIGHT / STEPS` の箱(底は y=0)。
結果として階段全体が「下から上へ伸びる階段状の塊」になり、**フロアNの床から
N+1 の床へ届く**。最上階(6F)は上に床が無いので生成しない。

実際の階段は踊り場付きの折返しだが、図面のハッチは1フライトぶんしか描いていない。
**図面が持っている情報以上のものを作らない**という v1 からの原則に従い、
直進1フライトで表現する(§18)。

### 12.2 エスカレーター

矩形を `lanes`(=2)で短辺方向に分割し、各レーンに:

- 斜行ランプ: 厚み 0.02 の板。長さ `hypot(run, LEVEL_HEIGHT)`、
  傾き `atan2(LEVEL_HEIGHT, run)`、`up` 軸まわりに回転して下端 y=0・上端 y=LEVEL_HEIGHT
- 両側の手すり縁: 高さ 0.05 の細い板をランプに平行に2本

上りと下りは幾何学的に同一のランプなので、ジオメトリは1つ作って
レーンぶん平行移動する。矢印の向き(上り/下り)は3D表現には出さない
—— テクスチャの矢印が既にそれを示している。

傾斜角は実物の30°ではなく、誇張された階高(`LEVEL_HEIGHT = 0.42`、§3)と
平面スケールの比で決まる。これは案内図であって測量図ではない(§18)。

### 12.3 エレベーター

**唯一の建物レベル要素**。1F床(y=0)から6F天井(y = levels × LEVEL_HEIGHT)まで
貫通する1本の半透明ガラス柱 + 縦エッジライン。

- フロアの `THREE.Group` **には入れない**。フロアグループは選択時の持ち上げ
  (`SELECTED_LIFT`)や `debugStack` で動くため、貫通シャフトが一緒に動いては困る。
  ビューア直下の `structureGroup` に置く
- 選択状態に**関わらず常時薄く表示**(opacity 0.10〜0.16)。フロアを1枚選んでも
  建物の高さ方向のスケールが画面に残り、6層の積層に「串」が通る
- `debugStack`(全フロアを y=0 に潰す検証モード)では非表示

## 13. 教室の什器

### 13.1 ホワイトボード

各教室矩形の `facing` 面(既定 `-z` = 北)の内側に、壁厚ぶん寄せて薄板を置く。

- 幅 = 教室幅 × 0.6(中央寄せ)
- 高さ 0.12、厚み 0.012、下端 y = 0.06(壁高 0.3 の中に収まる)

### 13.2 机

教室矩形に 15% のマージンを取り、残りの領域に自動グリッド配置。

```
pitchX = 0.145, pitchZ = 0.105   // 机 0.09 × 0.05 + 通路
cols = clamp(floor(usableX / pitchX), 1, 8)
rows = clamp(floor(usableZ / pitchZ), 1, 10)
```

余りは均等に振って中央寄せ。机は高さ 0.035 の低い箱。**行数・列数を部屋サイズから
導く**ので、部屋ごとに数字を書く必要がない(= アノテーションが増えない)。
上限クランプは大教室でジオメトリが爆発しないための保険。

### 13.3 「うるさくない」ための不透明度

| 状態 | 什器 opacity |
|---|---|
| 選択フロア | 0.15 |
| ALL | 0.06 |
| 減光フロア | 0.02(ほぼ消える) |

色はニュートラルなグレーミント `#9fd8c6`。壁(0.85)や図面(1.0)より
1桁近く薄く、**図面を読む邪魔をしない範囲でだけ存在する**。

### 13.4 対象範囲と、UIコピーの訂正義務

配置対象は教室のみ —— 3F: 301〜305 / 4F: 403〜408 / 5F: 502〜511(帯) /
6F: 601〜603 + PC教室列。1F(防災センター・テクノプラザ・エントランス)と
2F(事務エリア)には置かない。

**重要**: `map-screen.tsx` のインスペクタに現在
「壁は図面の線から抽出したもので、未確認の展示用オブジェクトは重ねていません」
と書いてある。v2 は想像で什器を置くので、この文はそのままでは**嘘になる**。
v2 では次のように書き換える(コミット `feat(map): classroom desks and whiteboards`
に同梱する):

> 壁と縦動線は公式図面の線・記号に基づいています。教室の机とホワイトボードは
> 実際の配置ではなく、広さの目安として置いた概略表現です。

### 13.5 共用部オブジェクト(床 vs 吹き抜けの最終手当)

§11 の開口だけでは「物が無い床」と「穴」が俯瞰で見分けにくい、というフィードバック
への追補。教室と同じ手法を共用部へ広げる: フロア別アノテーション `commons`
(`kind: "corridor" | "hall"`、歩行エリアの矩形)に、

- **corridor** — 長軸に沿ってピッチ 0.5 world でベンチ(箱)とプランター(円柱)を
  交互に、両縁へ寄せて配置(中央は歩行帯として空ける。幅 0.12 world 未満は片縁のみ)
- **hall** — ピッチ 0.35 world の市松に丸テーブル、四隅にプランター

を生成し、既存の什器メッシュへマージする(マテリアル・不透明度・トゥイーンの
配管は §13.3 のまま。ドローコール増ゼロ)。疑似乱数は使わない —— ロードごとに
配置が変わる散布は建物ではなくノイズに見える。あわせて ALL ビューの
`furniture 0.06→0.10` / `slab 0.18→0.24` を引き上げ、「物が載っている=床」
「空+光る縁=吹き抜け」の対比を積層ビューで成立させる。

commons は図面記号ではなく発明ゾーンなので、preview ツールの合格条件は
「フットプリント内で、吹き抜け・コア・教室行と重ならない」ことだけ(§10.5 注記)。
インスペクタ注記は「教室の机・ホワイトボードや廊下・ホールの備品は…概略表現」に更新。

### 13.6 決着 —— 床は「板」であって色味ではない

13.5 まででも「床が無い」と読まれた。原因は不透明度ではなく**スラブが暗すぎた**
こと(`#2a6154` は背景 `#0b1420` に対してほぼ沈む)。什器や縁の線で床を
**暗示する**のをやめ、スラブ自体を壁と同系のミント `#6ecfae`(emissive `#16463b`)
で照らし、不透明度を**常に壁の一段下**に置く:

| 状態 | wall | slab |
| --- | --- | --- |
| selected | 0.85 | 0.72 |
| all | 0.40 | 0.34 |
| dimmed | 0.05 | 0.04 |

「板が見える → その上に壁が立っている → 板が途切れている所が吹き抜け」という
読み順になる。開口の白い縁(§11.2 当初案)はこの時点で不要になり、削除した。

## 14. Unityライク・フライ操作

### 14.1 キー割当

| キー | 動作 |
|---|---|
| W / S | 前 / 後(視線の水平成分) |
| A / D | 左 / 右 |
| Q / E | 下 / 上(Unity準拠) |
| Shift | 3倍速 |

ヒント文言: `WASD 移動 / QE 上下 / DRAG 回転 / WHEEL ズーム`

### 14.2 移動基底 —— NORTH モードの縮退への対処

前方ベクトルはカメラ→`controls.target` の水平成分。ところが **NORTH モード
(真下視点)では水平成分がほぼゼロ**になり、前進方向が決まらない。

```
forward = (target - camera.position) を XZ に射影
if (|forward| < 1e-4) forward = カメラのローカル +Y 軸(world)を XZ に射影
right   = forward × worldUp
```

真下視点でカメラのローカル +Y は画面の上=図面の北を向くので、
**W が「画面の上へ」になる** —— 見たまま動く、という期待に一致する。

### 14.3 実装上の要点

- `camera.position` と `controls.target` に**同じ差分**を加える(純粋なパン)。
  OrbitControls の回転中心が一緒に動くので、移動後もその場で回せる
- `dt` ベース(`performance.now()` 差分、`dt <= 0.05s` にクランプしてタブ復帰時の
  ワープを防ぐ)。基準速度 2.2 world units/秒
- 押下中は `needsRender = true`。**v1 の省電力レンダループ(§5.1)は維持**する
- `keydown` / `keyup` は `window` にバインド。`blur` でキー集合をクリアしないと
  タブを離れた瞬間のキーが押しっぱなしになる
- `INPUT` / `TEXTAREA` / `SELECT` / `contenteditable` にフォーカスがあるとき、
  および `ctrl` / `meta` 併用時は無視(ブラウザショートカットを壊さない)。
  フロア選択ボタンにフォーカスがある状態では移動が効くが、`button` は
  A/D/W/S に固有の意味を持たないので実害はない
- OrbitControls の矢印キーパンは `listenToKeyEvents()` を呼んでいないので競合しない
- 移動範囲をクランプ(`|x| <= width×2`, `|z| <= depth×2`, `y ∈ [-1, 建物高+8]`)。
  飛びすぎてモデルを見失う事故を防ぐ
- `dispose()` で `keydown` / `keyup` / `blur` を必ず解除

## 15. シネマティックレンダリング

「3DCG感が足りない」の正体は、**背景がCSS・接地面が無い・線が発光しない・
状態変化が瞬間的**の4つ。順に潰す。

### 15.1 背景をシーンに一本化

v1 は `alpha: true` + `setClearColor(0, 0)` で CSS のラジアルグラデーションを
透かしていた。**EffectComposer はアルファ合成と相性が悪い**(ブルームは黒に対して
加算され、`OutputPass` は不透明に書く)ので、v2 では

- `scene.background = new THREE.Color(0x0b1420)`(現行 CSS と同色)
- レンダラは不透明。`.campus-3d-view` の CSS 背景は**初回フレーム前のちらつき
  防止のフォールバックとして残す**(canvas に隠れて見えない)

### 15.2 フォグと接地面

- `scene.fog = new THREE.FogExp2(0x0b1420, 0.035)` —— 背景と同色。
  `FogExp2` の減衰は `exp(-(density·d)²)` なので、d=14(NORTH の視距離)で 0.79、
  d=25 で 0.46。奥が溶けて手前が立つ。`MeshBasicMaterial` にもフォグは効くので、
  平面図テクスチャも距離に応じて沈む
- **グラウンド**: 建物下 y = -0.6 に `width×6 × depth×6` の平面。
  `CanvasTexture`(2048²)に、中心のラジアルグロー + 64px ピッチの細グリッドを
  描いて貼る。`FrontSide` にしておけば、Q キーで地面より下に潜っても
  不透明な板に視界を塞がれない

接地面は「一体感」に一番効く。浮いた6枚の板が、影の代わりに**空間の床**を
得ることでひとつの建物として読める。

### 15.3 トーンマッピングとブルーム

```ts
const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.6, 0.55));
composer.addPass(new OutputPass());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
```

- **`samples: 4`** が必須。コンポーザを挟むと描画先がレンダーターゲットになるため
  `WebGLRenderer({ antialias: true })` は無効化される。WebGL2 のマルチサンプル RT で
  v1 の AA 品質を取り戻す
- **`HalfFloatType`** はブルームのヘッドルームとバンディング対策
- 閾値 0.55 / 強度 0.35 —— 開口縁(§11.2)と壁のハイライトだけが越える設定。
  ブループリントの線がホログラムのように淡く光り、`linewidth` が使えない
  制約(§11.2)を「太さではなく光」で回収する

**注意すべき副作用**: v1 は平面図マテリアルに `toneMapped: false` を付けて
図面の明度を保証していたが、**コンポーザ経由ではこれが効かない**。
three.js はレンダーターゲットへ描くときマテリアル単位のトーンマップを無効化し、
`OutputPass` が画面全体に一括で適用するため。ACES はハイライトの彩度を落とすので、
図面のミントが濁る可能性がある。実装時に §17-10 のキャプチャで確認し、
濁るようなら `THREE.NeutralToneMapping`(色相保持に強い)へ切り替える。
`toneMapped: false` の記述自体は、コンポーザを切ったとき(下記 `?fx=off`)の
挙動として意味があるので残す。

- モバイル・低性能端末向けに `?fx=off` でコンポーザをバイパスし、
  `renderer.render()` の直接描画に落とすパスを用意する。
  ブルームは半解像度 RT を複数持つため、コストが読めない環境の逃げ道を作っておく

### 15.4 フロア切替のトゥイーン

現状は不透明度と持ち上げが即座に切り替わり、それが一番「CGっぽくなさ」を
出している。フレームレート非依存の指数平滑にする。

```
current += (target - current) * (1 - Math.exp(-dt / TAU))   // TAU = 0.12s
```

固定係数の lerp ではなく `1 - exp(-dt/τ)` を使うのは、60Hz と 120Hz で
到達時間を揃えるため。対象は各フロアの `plan` / `wall` / `slab` / `feature` の
不透明度と `lift`。全差分が `< 1e-3` になったら収束とみなして
`needsRender` を落とす —— **アニメーション中だけ回り、終わったら止まる**。

### 15.5 破棄とリサイズ

- `resize()` で `composer.setPixelRatio(pr)` と `composer.setSize(w, h)` を呼ぶ
  (`UnrealBloomPass` の内部 RT はコンポーザが転送する)
- `dispose()` に追加: `composer.dispose()`、レンダーターゲット、
  `UnrealBloomPass.dispose()`、グラウンドの `CanvasTexture` とマテリアル。
  v1 の「`dispose()` は全資源を確実に解放する」を維持する

## 16. 変更ファイル

| ファイル | 内容 |
|---|---|
| `src/lib/map/toyosu-classroom.features.json` | 新規: 手動アノテーション(§10.3) |
| `scripts/floorplan/preview_features.py` | 新規: アノテーション重畳検証ツール(§10.5) |
| `src/lib/map/features.ts` | 新規: features のロード・正規化・整合検証(§10.4) |
| `src/lib/map/build-features.ts` | 新規: 階段/エスカレーター/EV/什器のジオメトリ(§12, §13) |
| `src/lib/map/types.ts` | features の型、`BuildingDefinition` / `BuildingFloor` 拡張 |
| `src/lib/map/buildings.ts` | features の結合 |
| `src/lib/map/plan-transform.ts` | `planPxToNormalized()` を追加(§10.2) |
| `src/lib/map/build-floor-group.ts` | スラブを Extrude 化、開口縁、features 組み込み、renderOrder 整理 |
| `src/lib/map/floor-map-viewer.ts` | フライ操作、composer/bloom、グラウンド、フォグ、トゥイーン、EVシャフト |
| `src/components/map/map-screen.tsx` | ヒント文言、凡例に縦動線・吹き抜け・什器を追加、**インスペクタ注記の訂正(§13.4)** |
| `src/app/globals.css` | 凡例スウォッチの追加(`.guide-void` / `.guide-core` / `.guide-furniture`) |
| `docs/floor-map-3d.md` | 本章 |

### コミット計画(`feat/floor-map-rebuild` 上、push なし)

1. `docs: add floor map 3d design document`(v1 + v2)
2. `feat(map): add hand-annotated building features and preview tool`
3. `feat(map): footprint slabs with atrium openings`
4. `feat(map): stairs, escalators and elevator shafts`
5. `feat(map): classroom desks and whiteboards`(UIコピー訂正を同梱)
6. `feat(map): unity-like fly controls (WASD/QE)`
7. `feat(map): cinematic rendering (ground, fog, bloom, floor transitions)`

各コミットは単体で `tsc --noEmit` / `eslint` / `build` が通る状態にする。
2 と 3 の間に §10.5 の目視合格を挟むのが、この順序の理由。

## 17. v2 の検証手順

**アノテーション(実装前に完了させる)**

1. `python scripts/floorplan/preview_features.py`
2. `debug/features-{1..6}.png` を目視。§10.5 の合格条件(±5px)を満たすまで
   `features.json` を修正して繰り返す

**アプリ(dev サーバー + `window.__traceFloorMapViewer` + canvas キャプチャ)**

3. ORBIT / ALL —— グラウンドに接地しているか、開口縁がブルームで光っているか、
   スラブの穴から下階が見えるか
4. NORTH + 各フロア —— 階段・エスカレーター・EV・机が、図面記号の**真上**に
   乗っているか(v1 の位置合わせ回帰も同時に見る)
5. ALL —— EV シャフトが6層を貫通し、積層が1棟に見えるか
6. `?debug=stack` —— 全フロアを y=0 に潰して外周・コアが一本の線に見えるか。
   EV シャフトが非表示になっているか(§12.3)
7. フロア切替を10回以上 —— トゥイーンが滑らかで、収束後にレンダが止まること。
   `document.querySelector(".campus-3d-canvas")` が同一要素のままであること
   (**GL再生成ゼロ**の回帰チェック、v1 §7 と同じ)
8. WASD / QE / Shift を `KeyboardEvent` の注入で確認。特に **NORTH モードで
   W が画面の上へ動くこと**(§14.2 の縮退分岐)、`blur` 後にキーが残らないこと
9. `?fx=off` でコンポーザ無効時も破綻しないこと
10. 平面図の可読性 —— §15.3 のトーンマッピング副作用。濁るなら `NeutralToneMapping`
11. `npx tsc --noEmit` / `npx eslint .` / `npm run build` がクリーン
12. モバイル幅(≤680px)でレイアウト崩れなし、フレームレートが実用域

## 18. v2 で残る制限

- **アノテーションは手動**。図面(キャンパスダイアリー)が差し替わったら再実測が要る。
  `schemaVersion` / `buildingId` / 範囲チェック(§10.4)で「気づかず古いまま」は
  防げるが、更新作業そのものは自動化されない
- **階段は直進1フライト**。実際の折返し・踊り場は図面のハッチに描かれていないので
  作らない
- **エスカレーターの傾斜角は誇張された階高由来**で、実物の30°ではない
- **什器は想像**。座席数・向き・什器種別は実際の教室と無関係で、共用部の
  ベンチ・プランター・テーブル(§13.5)も同様の発明物(§13.4 で UI に明記)
- 斜め壁・曲面壁(1Fエントランスの曲線)は v1 同様、テクスチャにのみ写る
- 4F以上の南側ウィングは対象外(§1)。features.json は棟をまたがない
- ブルームは低性能端末で重い。`?fx=off` は逃げ道であって自動判定ではない
