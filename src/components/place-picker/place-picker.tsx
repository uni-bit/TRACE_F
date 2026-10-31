"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";

import { BlobImage } from "@/components/ping-log/blob-image";
import { Icon, NoteBar, Phrases, Screen, useRay } from "@/components/ping-log/ray/stage";
import { buildingName, buildingsWithPlaces, checkpointsOn, findCheckpoint, floorsOf, placeOf } from "@/lib/places/select";
import type { BuildingId, Checkpoint, PhotoPlace, PlacesData } from "@/lib/places/types";

import type { CampusMap as CampusMapView } from "./campus-map";

import "./place-picker.css";

/**
 * "Where was this photo taken?", answered on the map.
 *
 * The map is most of the screen. It opens on the whole campus, every building
 * drawn as a wire model of its floors, so a building is recognised by its
 * shape rather than its name: tap one, the map comes close and offers its
 * floors on a rail; on a floor its checkpoints light up, and one tap picks
 * one. The checkpoints outside are on the ground of the whole view. Nothing
 * is chosen by itself. Under the map a thin bar says what was picked and
 * saves it.
 *
 * Without the map (no WebGL, or the participant would rather) the same choice
 * is a list: building, floor, checkpoint. A place has to be chosen; the same
 * one may be chosen for any number of photos.
 */

/**
 * Without the map's code (offline, or a deploy replaced it while the page was
 * open) the list takes its place, as without WebGL, and the photo stays.
 */
function MapMissing({ onUnavailable }: ComponentProps<typeof CampusMapView>) {
  useEffect(() => onUnavailable(), [onUnavailable]);
  return null;
}

const CampusMap = dynamic(() => import("./campus-map").then((module) => module.CampusMap, () => MapMissing), {
  ssr: false,
  loading: () => (
    <p className="pp-map__wait mono mono--dim" role="status">
      Loading
    </p>
  ),
});

type Props = {
  data: PlacesData;
  /** The photo, for the thumbnail that says which one this is. */
  photo: Blob | null;
  /** The place of the photo before this one: "前回の場所" picks it in one tap. */
  last: PhotoPlace | null;
  /** Which photo of the day this is. */
  number: number;
  maxPhotos: number;
  saving: boolean;
  error: string;
  inert?: boolean;
  onBack: () => void;
  onConfirm: (place: PhotoPlace) => void;
};

/** "研究棟9F" already says where it is; "大階段の下" needs the building and floor in front of it. */
function placeLabel(data: PlacesData, point: Checkpoint): string {
  if (point.building === "outdoor") return point.name;
  const building = buildingName(data, point.building);
  return point.name.includes(building) ? point.name : `${building} ${point.floor} ・ ${point.name}`;
}

function tick(): void {
  // A short tick on each choice, where the phone has a motor.
  navigator.vibrate?.(8);
}

export function PlacePicker({ data, photo, last, number, maxPhotos, saving, error, inert = false, onBack, onConfirm }: Props) {
  const { go } = useRay();
  // The map: null is the whole campus. Outside checkpoints are picked there, so "outdoor" is never a building on the map.
  const [building, setBuilding] = useState<BuildingId | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOff, setMapOff] = useState(false);
  const [listMode, setListMode] = useState(false);
  const [zoom, setZoom] = useState(false);

  const selected = selectedId ? findCheckpoint(data, selectedId) : undefined;
  const lastPoint = useMemo(() => (last && last.graphVersion === data.graphVersion ? findCheckpoint(data, last.checkpointId) : undefined), [data, last]);
  const showList = mapOff || listMode;

  /** A building opens on its floors, none of them open and nothing chosen: the participant says which floor. */
  const chooseBuilding = useCallback((id: BuildingId | null) => {
    tick();
    setBuilding(id === "outdoor" ? null : id);
    setFloor(null);
  }, []);

  /** Opens a floor; nothing on it is chosen until the participant taps a checkpoint. */
  const chooseFloor = useCallback(
    (label: string) => {
      if (building === null || label === floor) return;
      tick();
      setFloor(label);
    },
    [building, floor],
  );

  const choosePoint = useCallback(
    (id: string) => {
      const point = findCheckpoint(data, id);
      if (!point) return;
      tick();
      setSelectedId(id);
      if (point.building === "outdoor") {
        setBuilding(null);
        setFloor(null);
      } else if (!(point.building === building || point.joins === building) || point.floor !== floor) {
        setBuilding(point.building);
        setFloor(point.floor);
      }
    },
    [data, building, floor],
  );

  const confirm = () => {
    if (selected && !saving) onConfirm(placeOf(data, selected));
  };

  const hint = selected ? placeLabel(data, selected) : "撮影した場所を選択してください。";

  return (
    <Screen key="place" className="screen--flex pp" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" disabled={saving} onClick={() => void go(onBack)}>
            <Icon name="back" />
            写真にもどる
          </button>
        </span>
        <span className="mono">
          {number} / {maxPhotos}
        </span>
        <span />
      </div>

      <header className="pp-head">
        <h1 className="h2">
          <Phrases text="どこで撮りましたか？" />
        </h1>
        {photo && (
          <button type="button" className="pp-thumb" aria-label="写真を大きく表示" onClick={() => setZoom(true)}>
            <BlobImage blob={photo} alt="" />
          </button>
        )}
      </header>
      {zoom && photo && <PhotoZoom photo={photo} onClose={() => setZoom(false)} />}

      {showList ? (
        <ListPicker data={data} selectedId={selectedId} onPick={choosePoint} note={mapOff ? "地図を表示できないので、一覧から選びます。" : null} />
      ) : (
        <div className="pp-map">
          <CampusMap
            data={data}
            building={building}
            floor={floor}
            selectedId={selectedId}
            onBuilding={chooseBuilding}
            onFloor={chooseFloor}
            onSelect={choosePoint}
            onUnavailable={() => setMapOff(true)}
            className="pp-map__canvas"
          />
        </div>
      )}

      <div className="pp-foot">
        <NoteBar text={error} alert />
        <div className="pp-foot__row">
          <p className="pp-summary" aria-live="polite" data-picked={selected ? "" : undefined}>
            {hint}
          </p>
          {!mapOff && (
            <button type="button" className="pp-mode mono" onClick={() => setListMode((value) => !value)}>
              {listMode ? "地図で選ぶ" : "一覧で選ぶ"}
            </button>
          )}
        </div>
        {lastPoint && lastPoint.id !== selectedId && (
          <button type="button" className="pp-again" onClick={() => choosePoint(lastPoint.id)}>
            <span className="mono">前回の場所</span>
            <span className="pp-again__name">{placeLabel(data, lastPoint)}</span>
          </button>
        )}
        <button type="button" className="btn" disabled={!selected || saving} onClick={confirm}>
          {saving ? (
            "保存しています…"
          ) : (
            <>
              <Icon name="check" />
              ここで保存
            </>
          )}
        </button>
      </div>
    </Screen>
  );
}

/** The photo at full size over the map, to see what is in it; a tap anywhere or Escape closes it. */
function PhotoZoom({ photo, onClose }: { photo: Blob; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="pp-zoom" role="dialog" aria-modal="true" aria-label="撮った写真" onClick={onClose}>
      <BlobImage blob={photo} alt="撮った写真" className="pp-zoom__img" />
      <button ref={closeRef} type="button" className="link pp-zoom__close" onClick={onClose}>
        <Icon name="close" />
        閉じる
      </button>
    </div>
  );
}

/** The same choice without the map: building, floor, checkpoint. */
function ListPicker({ data, selectedId, onPick, note }: { data: PlacesData; selectedId: string | null; onPick: (id: string) => void; note: string | null }) {
  const start = selectedId ? findCheckpoint(data, selectedId) : undefined;
  const [building, setBuilding] = useState<BuildingId>(start?.building ?? "outdoor");
  const [floor, setFloor] = useState(start?.floor ?? floorsOf(data, start?.building ?? "outdoor")[0]?.label ?? "");
  const buildings = useMemo(() => buildingsWithPlaces(data), [data]);
  const floors = useMemo(() => floorsOf(data, building), [data, building]);
  const points = useMemo(() => checkpointsOn(data, building, floor), [data, building, floor]);

  const chooseBuilding = (id: BuildingId) => {
    setBuilding(id);
    const options = floorsOf(data, id);
    setFloor(options.some((option) => option.label === floor) ? floor : (options[0]?.label ?? ""));
  };

  return (
    <div className="pp-list">
      {note && <p className="pp-list__note small">{note}</p>}
      <Rail label="建物">
        {buildings.map((item) => (
          <Chip key={item.id} active={item.id === building} onPick={() => chooseBuilding(item.id)}>
            {item.name}
          </Chip>
        ))}
      </Rail>
      <Rail label="階">
        {floors.map((item) => (
          <Chip key={item.label} active={item.label === floor} onPick={() => setFloor(item.label)} mono>
            {item.label}
          </Chip>
        ))}
      </Rail>
      <ul className="pp-points" role="radiogroup" aria-label="場所">
        {points.map((point) => (
          <PointRow key={point.id} point={point} data={data} active={point.id === selectedId} onPick={() => onPick(point.id)} />
        ))}
      </ul>
    </div>
  );
}

/** A row of chips that scrolls sideways, fading at the edges; the chosen chip is kept in view. */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  });
  return (
    <nav className="pp-rail" aria-label={label}>
      <ul ref={ref} className="pp-chips" role="radiogroup" aria-label={label}>
        {children}
      </ul>
    </nav>
  );
}

function Chip({ active, onPick, mono = false, children }: { active: boolean; onPick: () => void; mono?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" role="radio" aria-checked={active} className={`pp-chip${mono ? " pp-chip--mono" : ""}`} onClick={onPick}>
        {children}
      </button>
    </li>
  );
}

function PointRow({ point, data, active, onPick }: { point: Checkpoint; data: PlacesData; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" role="radio" aria-checked={active} className="pp-point" onClick={onPick}>
        <span className="pp-point__mark" aria-hidden="true" />
        <span className="pp-point__name">{point.name}</span>
        {point.joins && <span className="pp-point__tag mono">{buildingName(data, point.joins)}へ</span>}
      </button>
    </li>
  );
}
