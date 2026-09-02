"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  CAMPUS_OUTLINE,
  CAMPUS_SHEET,
  GEOFENCE_HULL,
  METRES_PER_PLAN_PX,
  NORTH_BEARING_DEG,
  buildingSheetRect,
  footprintCampusPx,
  localToCampusPx,
  planNormToCampusPx,
  type CampusPx,
} from "@/lib/geo/campus-georeference";
import { buildings } from "@/lib/map/buildings";
import { withBasePath } from "@/lib/base-path";

/**
 * The campus, one drawing, pannable and pinchable.
 *
 * Three things forced it. A per-building plan can only be pointed at from
 * inside that building, so a fix taken on the deck or the paving had no truth
 * to compare against. A plan scrolled by the browser cannot be zoomed by the
 * browser either — a same-origin element with its own scrollbox swallows the
 * gesture — so on a phone the only zoom was a pair of buttons. And a marker
 * drawn inside the drawing disappears the moment the position leaves the
 * drawing, which is exactly when the surveyor most needs to see it.
 *
 * So: one sheet holding every building's plate at its surveyed place, a
 * transform driven by pointer events rather than a scrollbox, and markers
 * drawn in screen space and clamped to the edge, never clipped away.
 *
 * The sheet can also be turned. The campus diary draws every floor square to
 * the buildings, and the buildings stand 43° off true north, so a drawing held
 * the way it was drawn does not line up with what the surveyor is looking at.
 * Turning it costs the drawing its square edges and gains it the one property
 * that matters in the field: the direction you are facing is up.
 */

/**
 * The plates are drawn at half the master-pixel density (the asset pipeline's
 * `texelsPerMasterPx`), so past about 0.5 the texture is being enlarged rather
 * than read, and past 1.5 there is nothing left to enlarge. The ceiling is set
 * where the drawing still says something: at 1.5, one screen pixel is 4 cm of
 * ground, finer than the 6 cm the nudge buttons step by.
 */
const SCALE_LIMITS = { min: 0.04, max: 1.5 };
/** Above this the texture is mush, so the extracted walls carry the drawing. */
const WALLS_FROM_SCALE = 0.28;
/** A finger that moves less than this was pointing, not dragging. */
const TAP_SLOP_PX = 8;
const TAP_MS = 600;
const EDGE_PAD_PX = 22;

export interface StationPin {
  id: string;
  px: CampusPx;
  level: number;
}

interface View {
  scale: number;
  /** Screen position of the sheet's origin, after the turn. */
  x: number;
  y: number;
}

/**
 * How far the sheet is turned on screen, clockwise-positive degrees.
 *
 * `NORTH_BEARING_DEG` is the true bearing of the sheet's own up direction: 43°
 * means up on the drawing points north-east, so true north lies up and to the
 * left. Turning the sheet clockwise by that same 43° brings north to vertical.
 */
function turnDeg(northUp: boolean): number {
  return northUp ? NORTH_BEARING_DEG : 0;
}

/** Sheet offset -> screen offset, the linear half of the view transform. */
function turn(dx: number, dy: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

interface Props {
  level: number;
  mark: CampusPx;
  onMarkChange: (px: CampusPx) => void;
  me: CampusPx | null;
  meAccuracyMetres: number | null;
  stations: StationPin[];
  onScaleChange?: (scale: number) => void;
}

interface Plate {
  id: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  texture: string;
  ghost: boolean;
  area: number;
  /** Slab outline, so the building reads as a shape when the line art does not. */
  outline: string;
  /** Extracted wall centrelines: the only part of the drawing that stays sharp. */
  walls: string;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, value));
}

/**
 * What each structure shows at this level. A building with no floor there is
 * still drawn — faintly, from its nearest plate — because a campus that loses
 * half its buildings when you switch to 9F is harder to point at, not easier.
 */
function platesFor(level: number): Plate[] {
  return buildings
    .map((building): Plate => {
      const exact = building.floors.find((floor) => floor.level === level);
      const floor =
        exact ??
        building.floors.reduce((best, candidate) =>
          Math.abs(candidate.level - level) < Math.abs(best.level - level) ? candidate : best,
        );
      const rect = buildingSheetRect(building.id);
      return {
        id: building.id,
        name: building.name,
        rect,
        texture: floor.texture,
        ghost: !exact,
        area: rect.width * rect.height,
        outline: footprintCampusPx(building.id, floor.id)
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" "),
        walls: floor.walls
          .map(([x1, z1, x2, z2]) => {
            const a = planNormToCampusPx(building.id, x1, z1);
            const b = planNormToCampusPx(building.id, x2, z2);
            return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
          })
          .join(""),
      };
    })
    .sort((a, b) => b.area - a.area);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const HULL_POINTS = GEOFENCE_HULL.map((vertex) => {
  const px = localToCampusPx(vertex);
  return `${px.x.toFixed(1)},${px.y.toFixed(1)}`;
}).join(" ");

export function CampusPlan({ level, mark, onMarkChange, me, meAccuracyMetres, stations, onScaleChange }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const tap = useRef<{ x: number; y: number; at: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 0.2, x: 0, y: 0 });
  // Field default: the surveyor is standing in it, not reading it at a desk.
  const [northUp, setNorthUp] = useState(true);
  const degrees = turnDeg(northUp);
  const touched = useRef(false);
  const plates = useMemo(() => platesFor(level), [level]);

  useEffect(() => onScaleChange?.(view.scale), [view.scale, onScaleChange]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Measured here as well as observed: the observer's first callback is not
    // guaranteed to arrive, and until a size lands the view has none and the
    // fit quietly does nothing — which is the whole map stuck at its initial
    // guess in the corner.
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize((current) =>
        current.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(
    (width = size.width, height = size.height, degreesNow = degrees) => {
      if (width === 0 || height === 0) return;
      // Fitted to the drawn slabs, not to the sheet: the sheet carries 30 m of
      // undrawn ground on every side so the surveyor can point at the paving,
      // and framing that emptiness leaves the campus a stamp in the middle.
      // The slabs rather than their bounding rectangle, because the campus runs
      // on a diagonal and turning that rectangle to north frames mostly sky.
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const point of CAMPUS_OUTLINE) {
        const turned = turn(point.x - CAMPUS_SHEET.x, point.y - CAMPUS_SHEET.y, degreesNow);
        x0 = Math.min(x0, turned.x);
        x1 = Math.max(x1, turned.x);
        y0 = Math.min(y0, turned.y);
        y1 = Math.max(y1, turned.y);
      }
      const scale = clampScale(Math.min(width / (x1 - x0), height / (y1 - y0)) * 0.94);
      setView({
        scale,
        x: (width - (x1 - x0) * scale) / 2 - x0 * scale,
        y: (height - (y1 - y0) * scale) / 2 - y0 * scale,
      });
    },
    [size.width, size.height, degrees],
  );

  // Refit while the view is still ours: the first measurement can arrive
  // before the web fonts settle the layout, and a phone changes the viewport
  // again when the address bar collapses. Once the surveyor has panned or
  // zoomed, the view is theirs and nothing takes it back.
  useEffect(() => {
    if (touched.current || size.width === 0 || size.height === 0) return;
    fit(size.width, size.height);
  }, [size, fit]);

  const screenOf = useCallback(
    (px: CampusPx) => {
      const offset = turn(px.x - CAMPUS_SHEET.x, px.y - CAMPUS_SHEET.y, degrees);
      return { x: offset.x * view.scale + view.x, y: offset.y * view.scale + view.y };
    },
    [view, degrees],
  );

  const sheetOf = useCallback(
    (point: { x: number; y: number }): CampusPx => {
      const offset = turn((point.x - view.x) / view.scale, (point.y - view.y) / view.scale, -degrees);
      return { x: offset.x + CAMPUS_SHEET.x, y: offset.y + CAMPUS_SHEET.y };
    },
    [view, degrees],
  );

  /** Zoom about a screen point, so what is under the fingers stays under them. */
  const zoomAbout = useCallback((factor: number, anchor: { x: number; y: number }) => {
    touched.current = true;
    setView((current) => {
      const scale = clampScale(current.scale * factor);
      const applied = scale / current.scale;
      return {
        scale,
        x: anchor.x - (anchor.x - current.x) * applied,
        y: anchor.y - (anchor.y - current.y) * applied,
      };
    });
  }, []);

  const centreOn = useCallback(
    (px: CampusPx) => {
      touched.current = true;
      setView((current) => {
        const offset = turn(px.x - CAMPUS_SHEET.x, px.y - CAMPUS_SHEET.y, degrees);
        return {
          scale: current.scale,
          x: size.width / 2 - offset.x * current.scale,
          y: size.height / 2 - offset.y * current.scale,
        };
      });
    },
    [size.width, size.height, degrees],
  );

  // Wheel has to be a native non-passive listener: React's onWheel is passive,
  // so preventDefault there is ignored and the page scrolls instead.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAbout(Math.exp(-event.deltaY * 0.0016), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  const local = (event: React.PointerEvent) => {
    const box = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Capture keeps a finger that slides off the viewport driving the gesture
    // rather than dropping it mid-drag. It is a nicety, not the mechanism: a
    // browser that refuses the capture must not lose the gesture with it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already gone, or not capturable here */
    }
    touched.current = true;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    tap.current = pointers.current.size === 1 ? { ...point, at: Date.now(), moved: false } : null;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point);
    const after = [...pointers.current.values()];

    if (after.length === 1) {
      const dx = after[0].x - before[0].x;
      const dy = after[0].y - before[0].y;
      if (tap.current && distance(point, tap.current) > TAP_SLOP_PX) tap.current.moved = true;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      return;
    }

    // Two fingers: the pair carries both the zoom and the pan, so the point
    // between them is what has to stay put — pinching also drags.
    const previousSpan = distance(before[0], before[1]);
    const currentSpan = distance(after[0], after[1]);
    if (previousSpan === 0) return;
    const previousMid = midpoint(before[0], before[1]);
    const currentMid = midpoint(after[0], after[1]);
    setView((current) => {
      const scale = clampScale(current.scale * (currentSpan / previousSpan));
      const applied = scale / current.scale;
      return {
        scale,
        x: currentMid.x - (previousMid.x - current.x) * applied,
        y: currentMid.y - (previousMid.y - current.y) * applied,
      };
    });
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = local(event);
    pointers.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* nothing to release */
    }
    const candidate = tap.current;
    tap.current = null;
    if (!candidate || candidate.moved || pointers.current.size > 0) return;
    if (Date.now() - candidate.at > TAP_MS || distance(point, candidate) > TAP_SLOP_PX) return;
    const sheet = sheetOf(point);
    onMarkChange({
      x: Math.min(CAMPUS_SHEET.x + CAMPUS_SHEET.width, Math.max(CAMPUS_SHEET.x, sheet.x)),
      y: Math.min(CAMPUS_SHEET.y + CAMPUS_SHEET.height, Math.max(CAMPUS_SHEET.y, sheet.y)),
    });
  };

  /**
   * A marker whose position is off the viewport is pinned to the edge it left
   * by, with how far away it is. The alternative — drawing it where it belongs
   * and letting `overflow: hidden` eat it — is the bug this replaces.
   */
  const pin = (px: CampusPx) => {
    const point = screenOf(px);
    const x = Math.min(size.width - EDGE_PAD_PX, Math.max(EDGE_PAD_PX, point.x));
    const y = Math.min(size.height - EDGE_PAD_PX, Math.max(EDGE_PAD_PX, point.y));
    const off = x !== point.x || y !== point.y;
    const centre = sheetOf({ x: size.width / 2, y: size.height / 2 });
    return {
      x,
      y,
      off,
      metres: distance(px, centre) * METRES_PER_PLAN_PX,
      // The label hangs off whichever side of the pin has room. A pin resting
      // on the left edge with a centred label loses half the label.
      chipClass: [
        x > size.width / 2 ? "is-right" : "is-left",
        y > size.height - 44 ? "is-above" : "",
      ].join(" "),
    };
  };

  const mePin = me ? pin(me) : null;
  const markPin = pin(mark);
  const accuracyPx = meAccuracyMetres === null ? null : meAccuracyMetres / METRES_PER_PLAN_PX;

  return (
    <div className="campus-plan">
      <div
        className="campus-plan-viewport"
        ref={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        role="presentation"
      >
        <div
          className="campus-plan-sheet"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) rotate(${degrees}deg) scale(${view.scale})` }}
        >
          {/* One SVG for the whole sheet. The plates were `<img>` elements
              until they came out blank: Chromium will not rasterize a bitmap
              inside a turned ancestor at this scale, while it rasterizes the
              same drawing as an SVG `<image>` without complaint. Keeping the
              slabs, plates and marks in one element also fixes their paint
              order, which position alone had been deciding.

              The slab under each plate matters on its own: at the zoom that
              fits the campus on a phone the traced line art is thinner than a
              pixel, and the slab is what stays legible. */}
          <svg
            className="campus-plan-overlay"
            width={CAMPUS_SHEET.width}
            height={CAMPUS_SHEET.height}
            viewBox={`${CAMPUS_SHEET.x} ${CAMPUS_SHEET.y} ${CAMPUS_SHEET.width} ${CAMPUS_SHEET.height}`}
            aria-hidden="true"
          >
            <polygon className="campus-plan-geofence" points={HULL_POINTS} />
            {plates.map((plate) => (
              <polygon
                key={plate.id}
                className={`campus-plan-slab ${plate.ghost ? "is-ghost" : ""}`}
                points={plate.outline}
              />
            ))}
            {plates.map((plate) => (
              <image
                key={plate.id}
                href={withBasePath(plate.texture)}
                x={plate.rect.x}
                y={plate.rect.y}
                width={plate.rect.width}
                height={plate.rect.height}
                opacity={plate.ghost ? 0.16 : 1}
                preserveAspectRatio="none"
              />
            ))}
            {view.scale > WALLS_FROM_SCALE &&
              plates
                .filter((plate) => !plate.ghost)
                .map((plate) => <path key={plate.id} className="campus-plan-walls" d={plate.walls} />)}
            {me && accuracyPx !== null && (
              <circle className="survey-plot-accuracy" cx={me.x} cy={me.y} r={accuracyPx} />
            )}
            {stations.map((station) => (
              <rect
                key={station.id}
                className={`survey-plot-station ${station.level === level ? "" : "is-other-level"}`}
                x={station.px.x - 6 / view.scale}
                y={station.px.y - 6 / view.scale}
                width={12 / view.scale}
                height={12 / view.scale}
              />
            ))}
            {/* Only where there is room: the plates overlap (the roof garden
                sits on the classroom building, the deck spans the gap), and a
                label for every one of them at campus zoom is a pile of text
                over the drawing rather than a way to find a building. */}
            {plates
              .filter((plate) => !plate.ghost && plate.rect.width * view.scale > 90)
              .map((plate) => (
                <text
                  key={plate.id}
                  className="campus-plan-label"
                  x={plate.rect.x + plate.rect.width / 2}
                  y={plate.rect.y + plate.rect.height / 2}
                  fontSize={12 / view.scale}
                  transform={`rotate(${-degrees} ${plate.rect.x + plate.rect.width / 2} ${plate.rect.y + plate.rect.height / 2})`}
                >{plate.name}</text>
              ))}
          </svg>
        </div>

        <div className="campus-plan-tools" onPointerDown={(event) => event.stopPropagation()}>
          <div className="survey-zoom">
            <button className="small-button" type="button" onClick={() => zoomAbout(1 / 1.6, { x: size.width / 2, y: size.height / 2 })} aria-label="縮小">−</button>
            <span>{Math.round(view.scale * 100)}%</span>
            <button className="small-button" type="button" onClick={() => zoomAbout(1.6, { x: size.width / 2, y: size.height / 2 })} aria-label="拡大">＋</button>
          </div>
          <div className="campus-plan-jumps">
            <button
              className={`small-button ${northUp ? "is-active" : ""}`}
              type="button"
              onClick={() => {
                const next = !northUp;
                setNorthUp(next);
                fit(size.width, size.height, turnDeg(next));
              }}
            >{northUp ? "北が上" : "図面の向き"}</button>
            <button className="small-button" type="button" onClick={() => fit()}>全体</button>
            <button className="small-button" type="button" onClick={() => centreOn(mark)}>指した点</button>
            <button className="small-button" type="button" disabled={!me} onClick={() => me && centreOn(me)}>現在地</button>
          </div>
        </div>

        <div className="campus-plan-compass" aria-hidden="true">
          <svg viewBox="-14 -14 28 28" style={{ transform: `rotate(${degrees - NORTH_BEARING_DEG}deg)` }}>
            <line x1="0" y1="10" x2="0" y2="-9" />
            <polygon points="0,-13 4,-5 -4,-5" />
          </svg>
          <span>N</span>
        </div>

        {mePin && (
          <div
            className={`campus-plan-pin is-me ${mePin.off ? "is-off" : ""}`}
            style={{ left: mePin.x, top: mePin.y }}
          >
            <span className="campus-plan-dot" />
            {mePin.off && (
              <span className={`campus-plan-chip ${mePin.chipClass}`}>
                現在地 {mePin.metres < 1000 ? `${Math.round(mePin.metres)}m` : `${(mePin.metres / 1000).toFixed(1)}km`}
              </span>
            )}
          </div>
        )}

        <div
          className={`campus-plan-pin is-mark ${markPin.off ? "is-off" : ""}`}
          style={{ left: markPin.x, top: markPin.y }}
        >
          <svg width="46" height="46" viewBox="-23 -23 46 46" aria-hidden="true">
            <line x1="0" y1="-21" x2="0" y2="21" />
            <line x1="-21" y1="0" x2="21" y2="0" />
            <circle cx="0" cy="0" r="6" />
          </svg>
          {markPin.off && (
            <span className={`campus-plan-chip ${markPin.chipClass}`}>
              指した点 {Math.round(markPin.metres)}m
            </span>
          )}
        </div>
      </div>

      <p className="survey-note campus-plan-hint">
        1本指でスクロール／2本指でピンチ拡大縮小／タップで印を置きます。範囲の外に出た印は縁に寄せて表示します。
      </p>
    </div>
  );
}
