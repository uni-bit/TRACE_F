"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { toyosuClassroom } from "@/lib/map/buildings";
import type { CameraMode } from "@/lib/map/types";
import { FloorMapCanvas } from "./floor-map-canvas";

const building = toyosuClassroom;
const DEFAULT_FLOOR_ID = "3";

function parseFloorParam(value: string | null): string | null {
  if (value === "all") return null;
  if (value && building.floors.some((floor) => floor.id === value)) return value;
  return DEFAULT_FLOOR_ID;
}

export function MapScreen() {
  const searchParams = useSearchParams();
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(() =>
    parseFloorParam(searchParams.get("floor")),
  );
  const debugStack = process.env.NODE_ENV !== "production" && searchParams.get("debug") === "stack";
  const selectedFloor = building.floors.find((floor) => floor.id === selectedFloorId);

  const selectFloor = (id: string | null) => {
    setSelectedFloorId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("floor", id ?? "all");
    window.history.replaceState(null, "", url);
  };

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
          <p className="map-intro-copy">芝浦工業大学の公式フロア案内図(キャンパスダイアリー2026)を基準に、教室棟1〜6階の床・壁・コアを立体表示しています。階を選ぶと、そのフロアを強調表示します。</p>
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
            <div className="map-floor-selector" aria-label="教室棟フロア選択">
              <span>CLASSROOM BUILDING / FLOOR PLAN</span>
              <button type="button" className={selectedFloorId === null ? "is-active" : ""} aria-pressed={selectedFloorId === null} onClick={() => selectFloor(null)}>ALL</button>
              {building.floors.map((floor) => <button type="button" key={floor.id} className={selectedFloorId === floor.id ? "is-active" : ""} aria-pressed={selectedFloorId === floor.id} onClick={() => selectFloor(floor.id)}>{floor.label}</button>)}
            </div>

            <div className={`map-stage ${cameraMode === "north" ? "map-stage-north" : ""}`}>
              <FloorMapCanvas building={building} selectedFloorId={selectedFloorId} cameraMode={cameraMode} debugStack={debugStack} />
              <div className="campus-3d-floor-readout">{selectedFloor ? `${selectedFloor.label} / ${selectedFloor.title}` : "ALL FLOORS"}</div>
              <div className="campus-3d-hint">WASD 移動 / QE 上下 / DRAG 回転 / WHEEL ズーム</div>
              <div className="map-compass" aria-hidden="true"><span>N</span><i /></div>
            </div>
            <div className="map-stage-footer"><span>THREE.JS / CLASSROOM BUILDING / OFFICIAL PLAN LAYERS</span><span>2D FLOOR MAPS / WALL LINES</span></div>
          </div>

          <aside className="map-inspector">
            <div className="inspector-status"><span className="status-check">✓</span><div><span>MODEL STATUS</span><strong>CLASSROOM BUILDING / READY</strong></div></div>
            <div className="version-grid"><div><span>BUILDING</span><strong>{building.name}</strong></div><div><span>LEVELS</span><strong>1F — 6F</strong></div><div><span>SOURCE</span><strong>CAMPUS DIARY 2026</strong></div></div>
            {selectedFloor && <div className="floor-detail"><div className="inspector-heading"><span>FLOOR DETAIL / {selectedFloor.label}</span><strong>OFFICIAL 2D PLAN</strong></div><strong className="floor-detail-title">{selectedFloor.title}</strong><Image src={selectedFloor.texture} alt={`${selectedFloor.label} 教室棟平面図`} width={building.plan.widthPx} height={building.plan.heightPx} /><div className="floor-room-tags">{selectedFloor.rooms.map((room) => <span key={room}>{room}</span>)}</div></div>}
            <div className="inspector-section building-register"><div className="inspector-heading"><span>00 / BUILDING REGISTER</span><strong>ONE BUILDING ONLY</strong></div><p className="inspector-note">展示対象は教室棟のみです。全フロアを公式PDFから共通の基準枠で切り出し、階段コアを基準に自動で位置合わせしています。壁と縦動線は公式図面の線・記号に基づいています。教室の机とホワイトボードは実際の配置ではなく、広さの目安として置いた概略表現です。</p><div className="building-list"><div className="building-row"><span className="building-swatch building-swatch-mint" /><span><strong>{building.name}</strong><small>{building.englishName}</small></span><em>{building.levelsLabel}</em></div></div></div>
            <div className="inspector-section view-guide"><div className="inspector-heading"><span>01 / VIEW GUIDE</span><strong>READABLE MODE</strong></div><p className="inspector-note">ALLで全階を重ねて確認できます。階を指定すると、その階の図面と壁を強調し、他階を薄く表示します。図面テクスチャと壁は同一の座標系を共有しているため、階を切り替えてもずれません。</p><div className="view-guide-keys"><span><i className="guide-wall" />図面壁線</span><span><i className="guide-floor" />階床</span><span><i className="guide-core" />縦動線(階段・EV・エスカレーター)</span><span><i className="guide-void" />吹き抜け</span><span><i className="guide-furniture" />什器(概略)</span></div></div>
          </aside>
        </section>
      </div>
    </main>
  );
}
