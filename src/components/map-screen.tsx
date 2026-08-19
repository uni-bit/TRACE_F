"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Campus3DView, type CampusBuilding3D } from "./campus-3d-view";
import { classroomFloors } from "../lib/toyosu-classroom-building";

type CameraMode = "orbit" | "north";

const classroomBuilding: CampusBuilding3D = {
  id: "classroom",
  name: "教室棟",
  englishName: "CLASSROOM BUILDING",
  // 教室棟単体の3Dビューでは、キャンパス全体座標ではなくビュー中央を基準にする。
  x: 33,
  y: 14,
  width: 34,
  height: 72,
  floors: "1–6F",
  levelCount: 6,
  heightM: "6F",
  shape: "standard",
  tone: "mint",
};

export function MapScreen() {
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>("3");
  const selectedFloor = classroomFloors.find((floor) => floor.id === selectedFloorId);

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
          <p className="map-intro-copy">芝浦工業大学の公式フロア案内図を基準に、教室棟1〜6階の階床・廊下・室区画・コアを立体表示しています。階を選ぶと、そのフロアを明るく表示します。</p>
        </section>

        <section className="map-workspace" aria-label="教室棟の3Dフロアマップ">
          <div className="map-stage-shell">
            <div className="map-stage-toolbar">
              <div><span className="toolbar-kicker">SPATIAL VIEW</span><strong>{cameraMode === "orbit" ? "ORBIT / 32°" : "NORTH / 00°"}</strong></div>
              <div className="map-stage-actions">
                <button type="button" className={cameraMode === "orbit" ? "is-active" : ""} onClick={() => setCameraMode("orbit")}>ORBIT</button>
                <button type="button" className={cameraMode === "north" ? "is-active" : ""} onClick={() => setCameraMode("north")}>NORTH</button>
              </div>
            </div>
            <div className="map-floor-selector" aria-label="教室棟フロア選択">
              <span>CLASSROOM BUILDING / FLOOR PLAN</span>
              <button type="button" className={selectedFloorId === null ? "is-active" : ""} aria-pressed={selectedFloorId === null} onClick={() => setSelectedFloorId(null)}>ALL</button>
              {classroomFloors.map((floor) => <button type="button" key={floor.id} className={selectedFloorId === floor.id ? "is-active" : ""} aria-pressed={selectedFloorId === floor.id} onClick={() => setSelectedFloorId(floor.id)}>{floor.label}</button>)}
            </div>

            <div className={`map-stage ${cameraMode === "north" ? "map-stage-north" : ""}`}>
              <Campus3DView building={classroomBuilding} classroomFloors={classroomFloors} selectedFloorId={selectedFloorId} cameraMode={cameraMode} />
              <div className="map-compass" aria-hidden="true"><span>N</span><i /></div>
            </div>
            <div className="map-stage-footer"><span>WEBGL / CLASSROOM BUILDING / OFFICIAL PLAN LAYERS</span><span>2D FLOOR MAPS / WALL LINES</span></div>
          </div>

          <aside className="map-inspector">
            <div className="inspector-status"><span className="status-check">✓</span><div><span>MODEL STATUS</span><strong>CLASSROOM BUILDING / READY</strong></div></div>
            <div className="version-grid"><div><span>BUILDING</span><strong>教室棟</strong></div><div><span>LEVELS</span><strong>1F — 6F</strong></div><div><span>SOURCE</span><strong>OFFICIAL FLOOR MAPS</strong></div></div>
            {selectedFloor && <div className="floor-detail"><div className="inspector-heading"><span>FLOOR DETAIL / {selectedFloor.label}</span><strong>OFFICIAL 2D PLAN</strong></div><strong className="floor-detail-title">{selectedFloor.title}</strong><Image src={selectedFloor.image} alt={`${selectedFloor.label} 教室棟平面図`} width={730} height={960} /><div className="floor-room-tags">{selectedFloor.rooms.map((room) => <span key={room}>{room}</span>)}</div></div>}
            <div className="inspector-section building-register"><div className="inspector-heading"><span>00 / BUILDING REGISTER</span><strong>ONE BUILDING ONLY</strong></div><p className="inspector-note">展示対象は教室棟のみです。公式PDFの床・壁線・室区画に加え、図面上の階段・エスカレーター・EVを構造として表示しています。未確認の展示用オブジェクトは重ねていません。</p><div className="building-list"><div className="building-row"><span className="building-swatch building-swatch-mint" /><span><strong>教室棟</strong><small>CLASSROOM BUILDING</small></span><em>1–6F</em></div></div></div>
            <div className="inspector-section view-guide"><div className="inspector-heading"><span>01 / VIEW GUIDE</span><strong>READABLE MODE</strong></div><p className="inspector-note">ALLで全階を確認できます。階を指定すると、その階の図面・壁線を強調し、他階を薄く表示します。PDFごとの位置差は同一縮尺のまま切り出し原点だけで吸収し、3〜6Fは教室列の上下端にある階段を共通アンカーにしています。</p><div className="view-guide-keys"><span><i className="guide-wall" />図面壁線</span><span><i className="guide-floor" />階床</span></div></div>
          </aside>
        </section>
      </div>
    </main>
  );
}
