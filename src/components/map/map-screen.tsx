"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState, type CSSProperties } from "react";

import { buildings, toyosuClassroom } from "@/lib/map/buildings";
import { METRES_PER_UNIT, PLAN_NORTH_BEARING_DEG } from "@/lib/map/plan-transform";
import { loadTweaks, saveTweaks, type MapTweaks } from "@/lib/map/tweaks";
import type { CameraMode, MapLayer } from "@/lib/map/types";
import { FloorMapCanvas } from "./floor-map-canvas";
import { TweaksPanel } from "./tweaks-panel";

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
];

function parseFloorParam(value: string | null): number | null {
  if (value === "all") return null;
  const level = Number(value);
  return Number.isInteger(level) && campusLevels.includes(level) ? level : DEFAULT_LEVEL;
}

/** Levels run from 0 up, because the headquarters has a basement. */
function floorLabel(level: number): string {
  return level > 0 ? `${level}F` : `B${1 - level}F`;
}

const campusLevelsLabel = `${floorLabel(campusLevels[0])}–${floorLabel(campusLevels[campusLevels.length - 1])}`;

function bearingLabel(degrees: number): string {
  return `${String(Math.round(degrees) % 360).padStart(3, "0")}°`;
}

export function MapScreen() {
  const searchParams = useSearchParams();
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [selectedLevel, setSelectedLevel] = useState<number | null>(() => parseFloorParam(searchParams.get("floor")));
  const [selectedBuildingId, setSelectedBuildingId] = useState(toyosuClassroom.id);
  const [northAngle, setNorthAngle] = useState(0);
  const handleNorthAngle = useCallback((degrees: number) => setNorthAngle(degrees), []);
  // Read once at mount rather than in an effect. It is safe to differ from the
  // server's value because nothing here reaches the markup: the tweaks are
  // handed to the canvas, which renders an empty div and draws in WebGL.
  const [tweaks, setTweaks] = useState<MapTweaks>(loadTweaks);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const changeTweaks = useCallback((next: MapTweaks) => {
    setTweaks(next);
    saveTweaks(next);
  }, []);
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
        <Link href="/" className="map-brand"><span>✦</span> TRACE / CAMPUS MAP</Link>
        <div className="map-header-meta"><span className="map-live-dot" /> 3D FLOOR MODEL <span className="map-header-divider" /> TOYOSU CAMPUS</div>
        <Link href="/" className="map-exit">戻る ↗</Link>
      </header>

      <div className="map-content">
        <section className="map-intro">
          <div>
            <p className="map-eyebrow">TOYOSU CAMPUS / OFFICIAL FLOOR MAPS</p>
            <h1>豊洲キャンパスを、<br /><em>階ごとに見る。</em></h1>
          </div>
          <p className="map-intro-copy">芝浦工業大学の公式フロア案内図(キャンパスダイアリー2026)を基準に、教室棟・研究棟・交流棟・本部棟を階ごとの床・壁・コアとして立体表示しています。階を選ぶと、その階を持つすべての棟を水平スライスとして強調します。</p>
        </section>

        <section className="map-workspace" aria-label="豊洲キャンパスの3Dフロアマップ">
          <div className="map-stage-shell">
            <div className="map-stage-toolbar">
              <div><span className="toolbar-kicker">SPATIAL VIEW</span><strong>{cameraMode === "orbit" ? "ORBIT" : "NORTH"} / N {bearingLabel(northAngle)}</strong></div>
              <div className="map-stage-actions">
                <button type="button" className={cameraMode === "orbit" ? "is-active" : ""} onClick={() => setCameraMode("orbit")}>ORBIT</button>
                <button type="button" className={cameraMode === "north" ? "is-active" : ""} onClick={() => setCameraMode("north")}>NORTH</button>
                <button type="button" className={tweaksOpen ? "is-active" : ""} aria-pressed={tweaksOpen} onClick={() => setTweaksOpen((open) => !open)}>TWEAKS</button>
              </div>
            </div>
            <div className="map-floor-selector" aria-label="キャンパスフロア選択">
              <span>{buildings.length === 1 ? "CLASSROOM BUILDING / FLOOR PLAN" : "TOYOSU CAMPUS / FLOOR PLAN"}</span>
              <button type="button" className={selectedLevel === null ? "is-active" : ""} aria-pressed={selectedLevel === null} onClick={() => selectFloor(null)}>ALL</button>
              {campusLevels.map((level) => <button type="button" key={level} className={selectedLevel === level ? "is-active" : ""} aria-pressed={selectedLevel === level} onClick={() => selectFloor(level)}>{floorLabel(level)}</button>)}
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
              <FloorMapCanvas buildings={buildings} selectedLevel={selectedLevel} cameraMode={cameraMode} debugStack={debugStack} effects={effects} layerVisibility={layerVisibility} onNorthAngle={handleNorthAngle} tweaks={tweaks} />
              <div className="campus-3d-floor-readout">{selectedLevel === null ? "ALL FLOORS" : selectedFloor ? `${selectedFloor.label} / ${selectedFloor.title}` : `${floorLabel(selectedLevel)} / CAMPUS`}</div>
              <div className="campus-3d-hint">WASD 移動 / QE 上下 / DRAG 回転 / WHEEL ズーム</div>
              {tweaksOpen && <TweaksPanel tweaks={tweaks} onChange={changeTweaks} onClose={() => setTweaksOpen(false)} />}
              <div className="map-compass" style={{ "--north-angle": `${northAngle}deg` } as CSSProperties} aria-hidden="true"><i /><span>N</span></div>
            </div>
            <div className="map-stage-footer"><span>THREE.JS / FOUR BUILDINGS / OFFICIAL PLAN LAYERS</span><span>{campusLevelsLabel} / HORIZONTAL CAMPUS SLICE</span></div>
          </div>

          <aside className="map-inspector">
            <div className="inspector-status"><span className="status-check">✓</span><div><span>MODEL STATUS</span><strong>TOYOSU CAMPUS / READY</strong></div></div>
            <div className="version-grid"><div><span>BUILDING</span><strong>{selectedBuilding.name}</strong></div><div><span>LEVELS</span><strong>{selectedBuilding.levelsLabel}</strong></div><div><span>SOURCE</span><strong>CAMPUS DIARY 2026</strong></div></div>
            {selectedFloor && <div className="floor-detail"><div className="inspector-heading"><span>FLOOR DETAIL / {selectedFloor.label}</span><strong>OFFICIAL 2D PLAN</strong></div><strong className="floor-detail-title">{selectedFloor.title}</strong><Image src={selectedFloor.texture} alt={`${selectedFloor.label} ${selectedBuilding.name}平面図`} width={selectedBuilding.plan.widthPx} height={selectedBuilding.plan.heightPx} /><div className="floor-room-tags">{selectedFloor.rooms.map((room) => <span key={room}>{room}</span>)}</div></div>}
            <div className="inspector-section building-register"><div className="inspector-heading"><span>00 / BUILDING REGISTER</span><strong>ALL BUILDINGS / SELECT</strong></div><p className="inspector-note">全棟の全フロアを公式PDFから棟別の基準枠で切り出し、階段コアを基準に自動で位置合わせしています。棟同士の配置は同じ参照ページ上の誌面座標から算出したもので、測量結果ではありません。図面は建物に正対して描かれているため、真北はステージ上で図面の上方向から{PLAN_NORTH_BEARING_DEG}°ずれています(実測値。コンパスは真北を指します)。スケールは図面1単位≒{METRES_PER_UNIT}m、階高は本部棟の基準階階高4.2mです。壁と縦動線は図面の線・記号に基づき、机・ホワイトボードや共用部の備品は広さを読むための概略表現です。棟を選ぶと右上の2D図面が切り替わります。</p><div className="building-list">{buildingRows}</div></div>
            <div className="inspector-section view-guide"><div className="inspector-heading"><span>01 / VIEW GUIDE</span><strong>READABLE MODE</strong></div><p className="inspector-note">ALLで4棟の全階を重ねて確認できます。階を指定すると、その階を持つすべての棟の図面と壁を強調し、他階を薄く表示します。図面テクスチャと壁は棟ごとに同一の座標系を共有しています。</p><div className="view-guide-keys"><span><i className="guide-wall" />図面壁線</span><span><i className="guide-floor" />階床</span><span><i className="guide-core" />縦動線(階段・EV・エスカレーター)</span><span><i className="guide-void" />吹き抜け(床が抜けている所)</span><span><i className="guide-furniture" />什器(概略)</span></div></div>
          </aside>
        </section>
      </div>
    </main>
  );
}
