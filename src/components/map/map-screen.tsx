"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { buildings, toyosuClassroom } from "@/lib/map/buildings";
import type { CameraMode, MapLayer } from "@/lib/map/types";
import { FloorMapCanvas } from "./floor-map-canvas";

const DEFAULT_LEVEL = 3;
const campusLevels = [...new Set(buildings.flatMap((building) => building.floors.map((floor) => floor.level)))].sort((a, b) => a - b);
const DEBUG_LAYERS: { id: MapLayer; label: string }[] = [
  { id: "slab", label: "slab" },
  { id: "plan", label: "plan" },
  { id: "walls", label: "walls" },
  { id: "cores", label: "cores" },
  { id: "furniture", label: "furniture" },
  { id: "outline", label: "outline" },
  { id: "shafts", label: "shafts" },
  { id: "neighbors", label: "neighbors" },
];

function parseFloorParam(value: string | null): number | null {
  if (value === "all") return null;
  const level = Number(value);
  return Number.isInteger(level) && campusLevels.includes(level) ? level : DEFAULT_LEVEL;
}

export function MapScreen() {
  const searchParams = useSearchParams();
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [selectedLevel, setSelectedLevel] = useState<number | null>(() => parseFloorParam(searchParams.get("floor")));
  const [selectedBuildingId, setSelectedBuildingId] = useState(toyosuClassroom.id);
  const [layerVisibility, setLayerVisibility] = useState<Record<MapLayer, boolean>>(() =>
    Object.fromEntries(DEBUG_LAYERS.map(({ id }) => [id, true])) as Record<MapLayer, boolean>,
  );
  const debugStack = process.env.NODE_ENV !== "production" && searchParams.get("debug") === "stack";
  const debugLayers = process.env.NODE_ENV !== "production" && searchParams.get("debug") === "layers";
  const effects = searchParams.get("fx") !== "off";
  const selectedBuilding = buildings.find((building) => building.id === selectedBuildingId) ?? buildings[0];
  const selectedFloor = selectedBuilding.floors.find((floor) => floor.level === selectedLevel);

  const selectFloor = (level: number | null) => {
    setSelectedLevel(level);
    const url = new URL(window.location.href);
    url.searchParams.set("floor", level?.toString() ?? "all");
    window.history.replaceState(null, "", url);
  };

  const buildingRows = buildings.map((building) => {
    const content = (
      <>
        <span className="building-swatch building-swatch-mint" />
        <span><strong>{building.name}</strong><small>{building.englishName}</small></span>
        <em>{building.levelsLabel}</em>
      </>
    );
    return buildings.length > 1 ? (
      <button type="button" key={building.id} className={`building-row${building.id === selectedBuilding.id ? " is-active" : ""}`} aria-pressed={building.id === selectedBuilding.id} onClick={() => setSelectedBuildingId(building.id)}>
        {content}
      </button>
    ) : <div className="building-row" key={building.id}>{content}</div>;
  });

  return (
    <main className="map-app">
      <header className="map-header">
        <Link href="/" className="map-brand"><span>✦</span> TRACE / CLASSROOM MAP</Link>
        <div className="map-header-meta"><span className="map-live-dot" /> 3D FLOOR MODEL <span className="map-header-divider" /> TOYOSU CAMPUS</div>
        <Link href="/" className="map-exit">戻る ↗</Link>
      </header>

      <div className="map-content">
        <section className="map-intro">
          <div>
            <p className="map-eyebrow">CLASSROOM BUILDING / OFFICIAL FLOOR MAPS</p>
            <h1>教室棟を、<br /><em>階ごとに見る。</em></h1>
          </div>
          <p className="map-intro-copy">芝浦工業大学の公式フロア案内図(キャンパスダイアリー2026)を基準に、教室棟1〜6階の床・壁・コアを立体表示しています。周辺棟は案内図の誌面レイアウトに沿った概略マッシングです。階を選ぶと、教室棟の該当フロアを強調表示します。</p>
        </section>

        <section className="map-workspace" aria-label="教室棟の3Dフロアマップ">
          <div className="map-stage-shell">
            <div className="map-stage-toolbar">
              <div><span className="toolbar-kicker">SPATIAL VIEW</span><strong>{cameraMode === "orbit" ? "ORBIT" : "NORTH / 00°"}</strong></div>
              <div className="map-stage-actions">
                <button type="button" className={cameraMode === "orbit" ? "is-active" : ""} onClick={() => setCameraMode("orbit")}>ORBIT</button>
                <button type="button" className={cameraMode === "north" ? "is-active" : ""} onClick={() => setCameraMode("north")}>NORTH</button>
              </div>
            </div>
            <div className="map-floor-selector" aria-label="キャンパスフロア選択">
              <span>{buildings.length === 1 ? "CLASSROOM BUILDING / FLOOR PLAN" : "TOYOSU CAMPUS / FLOOR PLAN"}</span>
              <button type="button" className={selectedLevel === null ? "is-active" : ""} aria-pressed={selectedLevel === null} onClick={() => selectFloor(null)}>ALL</button>
              {campusLevels.map((level) => <button type="button" key={level} className={selectedLevel === level ? "is-active" : ""} aria-pressed={selectedLevel === level} onClick={() => selectFloor(level)}>{level}F</button>)}
            </div>
            {debugLayers && (
              <fieldset className="map-layer-debug">
                <legend>DEV / LAYER VISIBILITY</legend>
                {DEBUG_LAYERS.map(({ id, label }) => (
                  <label key={id}>
                    <input type="checkbox" checked={layerVisibility[id]} onChange={(event) => setLayerVisibility((current) => ({ ...current, [id]: event.target.checked }))} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            )}

            <div className={`map-stage ${cameraMode === "north" ? "map-stage-north" : ""}`}>
              <FloorMapCanvas buildings={buildings} selectedLevel={selectedLevel} cameraMode={cameraMode} debugStack={debugStack} effects={effects} layerVisibility={layerVisibility} />
              <div className="campus-3d-floor-readout">{selectedLevel === null ? "ALL FLOORS" : selectedFloor ? `${selectedFloor.label} / ${selectedFloor.title}` : `${selectedLevel}F / CAMPUS`}</div>
              <div className="campus-3d-hint">WASD 移動 / QE 上下 / DRAG 回転 / WHEEL ズーム</div>
              <div className="map-compass" aria-hidden="true"><span>N</span><i /></div>
            </div>
            <div className="map-stage-footer"><span>THREE.JS / CLASSROOM BUILDING / OFFICIAL PLAN LAYERS</span><span>CAMPUS CONTEXT / SCHEMATIC MASSING</span></div>
          </div>

          <aside className="map-inspector">
            <div className="inspector-status"><span className="status-check">✓</span><div><span>MODEL STATUS</span><strong>CLASSROOM BUILDING / READY</strong></div></div>
            <div className="version-grid"><div><span>BUILDING</span><strong>{selectedBuilding.name}</strong></div><div><span>LEVELS</span><strong>1F — {Math.max(...selectedBuilding.floors.map((floor) => floor.level))}F</strong></div><div><span>SOURCE</span><strong>CAMPUS DIARY 2026</strong></div></div>
            {selectedFloor && <div className="floor-detail"><div className="inspector-heading"><span>FLOOR DETAIL / {selectedFloor.label}</span><strong>OFFICIAL 2D PLAN</strong></div><strong className="floor-detail-title">{selectedFloor.title}</strong><Image src={selectedFloor.texture} alt={`${selectedFloor.label} ${selectedBuilding.name}平面図`} width={selectedBuilding.plan.widthPx} height={selectedBuilding.plan.heightPx} /><div className="floor-room-tags">{selectedFloor.rooms.map((room) => <span key={room}>{room}</span>)}</div></div>}
            <div className="inspector-section building-register"><div className="inspector-heading"><span>00 / BUILDING REGISTER</span><strong>PRIMARY + CONTEXT</strong></div><p className="inspector-note">詳細表示の対象は教室棟です。全フロアを公式PDFから共通の基準枠で切り出し、階段コアを基準に自動で位置合わせしています。壁と縦動線は公式図面の線・記号に基づき、周辺3棟は案内図の誌面レイアウトから外形を抽出した概略マッシングです。配置は測量結果ではありません。教室の机・ホワイトボードや廊下・ホールの備品も実際の配置ではなく、広さの目安として置いた概略表現です。</p><div className="building-list">{buildingRows}</div></div>
            <div className="inspector-section view-guide"><div className="inspector-heading"><span>01 / VIEW GUIDE</span><strong>READABLE MODE</strong></div><p className="inspector-note">ALLで全階を重ねて確認できます。階を指定すると、その階の図面と壁を強調し、他階を薄く表示します。図面テクスチャと壁は同一の座標系を共有しているため、階を切り替えてもずれません。</p><div className="view-guide-keys"><span><i className="guide-wall" />図面壁線</span><span><i className="guide-floor" />階床</span><span><i className="guide-core" />縦動線(階段・EV・エスカレーター)</span><span><i className="guide-void" />吹き抜け(床が抜けている所)</span><span><i className="guide-furniture" />什器(概略)</span><span><i className="guide-neighbor" />周辺棟(概略マッシング)</span></div></div>
          </aside>
        </section>
      </div>
    </main>
  );
}
