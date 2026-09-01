import { toyosuClassroom } from "@/lib/map/buildings";
import {
  COORDINATE_VERSION,
  bearingDeg,
  distanceMetres,
  localToPlanMetres,
  localToWgs84,
  planPxToLocal,
  wgs84ToLocal,
  type LocalEnu,
  type Wgs84,
} from "./campus-georeference";

/**
 * The field log. One question: does the position the browser reports, put
 * through the campus transform, land where the surveyor actually stands?
 *
 * The truth side of that comparison is a human pointing at the floor plan.
 * That pointing has its own error, and it is not constant — standing against a
 * drawn wall is a different claim from standing "about here" in a corridor —
 * so each station records how confidently it was placed. A 6 m residual means
 * nothing until you know whether the truth was good to 0.3 m or to 2 m.
 *
 * Persistence: docs/frontend-design.md forbids storing participant GPS on the
 * device. That rule is about participants. This is a staff instrument
 * recording the surveyor's own position at points chosen in advance, it is not
 * reachable from the participant flow, and losing an afternoon of fieldwork to
 * an accidental reload is the worse failure — so it persists, under its own
 * key, with a visible erase button.
 */

export const SURVEY_STORAGE_KEY = "trace.position-survey.v1";
export const SURVEY_SCHEMA_VERSION = 1;
/** Enough for a couple of hours at 1 Hz before the oldest is dropped. */
const TRACK_LIMIT = 6000;

export interface Fix {
  /** Epoch ms, from the fix itself rather than from when we processed it. */
  t: number;
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

/** How precisely the surveyor could point at where they stood. */
export type TruthConfidence = "wall" | "feature" | "open";

export const TRUTH_CONFIDENCE: Record<TruthConfidence, { label: string; metres: number }> = {
  wall: { label: "壁・柱に接して立った", metres: 0.3 },
  feature: { label: "ドア枠・部屋の隅など図面上の目印", metres: 0.5 },
  open: { label: "廊下や部屋の中ほど（目印なし）", metres: 2 },
};

export interface GroundTruth {
  floorId: string;
  level: number;
  /** Plan pixels in the classroom building's 912x1552 coordinate space. */
  x: number;
  y: number;
  confidence: TruthConfidence;
}

export interface Station {
  id: string;
  label: string;
  truth: GroundTruth;
  note: string;
  startedAt: number;
  endedAt: number;
  fixes: Fix[];
}

export interface SurveyState {
  schemaVersion: number;
  coordinateVersion: string;
  createdAt: number;
  stations: Station[];
  track: Fix[];
  trackTruncated: boolean;
}

export function emptySurvey(): SurveyState {
  return {
    schemaVersion: SURVEY_SCHEMA_VERSION,
    coordinateVersion: COORDINATE_VERSION,
    createdAt: Date.now(),
    stations: [],
    track: [],
    trackTruncated: false,
  };
}

export function toFix(position: GeolocationPosition): Fix {
  return {
    t: position.timestamp,
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    altitudeAccuracy: position.coords.altitudeAccuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
  };
}

export function appendTrack(state: SurveyState, fix: Fix): SurveyState {
  const track = [...state.track, fix];
  const overflow = track.length - TRACK_LIMIT;
  return {
    ...state,
    track: overflow > 0 ? track.slice(overflow) : track,
    trackTruncated: state.trackTruncated || overflow > 0,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Nearest-rank percentile; with 30–120 samples nothing is gained by interpolating. */
export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function truthLocal(truth: GroundTruth): LocalEnu {
  return planPxToLocal({ buildingId: toyosuClassroom.id, x: truth.x, y: truth.y });
}

export interface FixSummary {
  count: number;
  /** Component-wise median in ENU metres: robust to the odd wild fix. */
  local: LocalEnu;
  wgs84: Wgs84;
  /** Radius about the median containing 95% of the fixes. */
  spreadP95: number;
  /** What the device claimed, for comparison with the spread we measured. */
  reportedAccuracyMedian: number;
  /** null when the fix carries no vertical component at all — itself a result. */
  altitudeMedian: number | null;
  altitudeAccuracyMedian: number | null;
  altitudeSpreadP95: number | null;
  withAltitude: number;
  durationSeconds: number;
}

export function summarize(fixes: Fix[]): FixSummary | null {
  if (fixes.length === 0) return null;
  const locals = fixes.map((fix) => wgs84ToLocal({ lat: fix.lat, lon: fix.lon }));
  const local: LocalEnu = {
    east: median(locals.map((point) => point.east)),
    north: median(locals.map((point) => point.north)),
  };
  const altitudes = fixes.map((fix) => fix.altitude).filter((value): value is number => value !== null);
  const altitudeAccuracies = fixes
    .map((fix) => fix.altitudeAccuracy)
    .filter((value): value is number => value !== null);
  const altitudeMedian = altitudes.length ? median(altitudes) : null;
  return {
    count: fixes.length,
    local,
    wgs84: localToWgs84(local),
    spreadP95: percentile(locals.map((point) => distanceMetres(point, local)), 0.95),
    reportedAccuracyMedian: median(fixes.map((fix) => fix.accuracy)),
    altitudeMedian,
    altitudeAccuracyMedian: altitudeAccuracies.length ? median(altitudeAccuracies) : null,
    altitudeSpreadP95:
      altitudeMedian === null ? null : percentile(altitudes.map((value) => Math.abs(value - altitudeMedian)), 0.95),
    withAltitude: altitudes.length,
    durationSeconds: (fixes[fixes.length - 1].t - fixes[0].t) / 1000,
  };
}

export interface Residual {
  /** Measured minus pointed-at, in metres. */
  east: number;
  north: number;
  distance: number;
  bearing: number;
  /** How much of the distance the truth itself could account for. */
  truthUncertainty: number;
}

export function residual(measured: LocalEnu, truth: GroundTruth): Residual {
  const target = truthLocal(truth);
  return {
    east: measured.east - target.east,
    north: measured.north - target.north,
    distance: distanceMetres(measured, target),
    bearing: bearingDeg(target, measured),
    truthUncertainty: TRUTH_CONFIDENCE[truth.confidence].metres,
  };
}

export interface StationReport {
  station: Station;
  summary: FixSummary | null;
  residual: Residual | null;
}

export function reportFor(station: Station): StationReport {
  const summary = summarize(station.fixes);
  return { station, summary, residual: summary ? residual(summary.local, station.truth) : null };
}

export interface FloorAltitude {
  level: number;
  label: string;
  stations: number;
  altitudeMedian: number | null;
  altitudeAccuracyMedian: number | null;
}

export interface SurveyTotals {
  stations: number;
  scored: number;
  meanError: number;
  p95Error: number;
  worstStationId: string | null;
  /** Median altitude per floor. Storeys are 4.2 m apart; see if these are too. */
  floors: FloorAltitude[];
  smallestFloorGap: number | null;
  /** Fixes that carried no altitude at all, over every station. */
  fixesWithoutAltitude: number;
  fixesTotal: number;
}

/**
 * coordinate-mapping.md asks for at least three validation points and a p95.
 * This is that number, computed live so the count and the spread are visible
 * while there is still time to walk to another point.
 */
export function totals(state: SurveyState): SurveyTotals {
  const reports = state.stations.map(reportFor);
  const errors = reports
    .map((report) => report.residual?.distance)
    .filter((value): value is number => value !== undefined);
  const worst = reports.reduce<StationReport | null>(
    (best, report) =>
      report.residual && (!best?.residual || report.residual.distance > best.residual.distance) ? report : best,
    null,
  );

  const byLevel = new Map<number, { label: string; altitudes: number[]; accuracies: number[]; stations: number }>();
  for (const report of reports) {
    const level = report.station.truth.level;
    const entry = byLevel.get(level) ?? {
      label: toyosuClassroom.floors.find((floor) => floor.level === level)?.label ?? `${level}F`,
      altitudes: [],
      accuracies: [],
      stations: 0,
    };
    entry.stations += 1;
    if (report.summary?.altitudeMedian !== null && report.summary?.altitudeMedian !== undefined) {
      entry.altitudes.push(report.summary.altitudeMedian);
    }
    if (report.summary?.altitudeAccuracyMedian != null) entry.accuracies.push(report.summary.altitudeAccuracyMedian);
    byLevel.set(level, entry);
  }
  const floors: FloorAltitude[] = [...byLevel.entries()]
    .map(([level, entry]) => ({
      level,
      label: entry.label,
      stations: entry.stations,
      altitudeMedian: entry.altitudes.length ? median(entry.altitudes) : null,
      altitudeAccuracyMedian: entry.accuracies.length ? median(entry.accuracies) : null,
    }))
    .sort((a, b) => a.level - b.level);

  let smallestFloorGap: number | null = null;
  const measured = floors.filter((floor) => floor.altitudeMedian !== null);
  for (let index = 1; index < measured.length; index += 1) {
    const gap = measured[index].altitudeMedian! - measured[index - 1].altitudeMedian!;
    if (smallestFloorGap === null || gap < smallestFloorGap) smallestFloorGap = gap;
  }

  const fixesTotal = reports.reduce((sum, report) => sum + (report.summary?.count ?? 0), 0);
  const withAltitude = reports.reduce((sum, report) => sum + (report.summary?.withAltitude ?? 0), 0);

  return {
    stations: state.stations.length,
    scored: errors.length,
    meanError: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : Number.NaN,
    p95Error: percentile(errors, 0.95),
    worstStationId: worst?.station.id ?? null,
    floors,
    smallestFloorGap,
    fixesWithoutAltitude: fixesTotal - withAltitude,
    fixesTotal,
  };
}

export function loadSurvey(): SurveyState {
  if (typeof window === "undefined") return emptySurvey();
  try {
    const raw = window.localStorage.getItem(SURVEY_STORAGE_KEY);
    if (!raw) return emptySurvey();
    const parsed = JSON.parse(raw) as SurveyState;
    if (parsed.schemaVersion !== SURVEY_SCHEMA_VERSION) return emptySurvey();
    return { ...emptySurvey(), ...parsed };
  } catch {
    return emptySurvey();
  }
}

export function saveSurvey(state: SurveyState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Quota or private mode: the in-memory state is still the live one. */
  }
}

/** The file that leaves the phone. Raw fixes are kept — the summary is derived. */
export function toExport(state: SurveyState): string {
  return JSON.stringify(
    {
      schemaVersion: state.schemaVersion,
      coordinateVersion: state.coordinateVersion,
      exportedAt: new Date().toISOString(),
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
      totals: totals(state),
      stations: state.stations.map((station) => {
        const report = reportFor(station);
        const local = truthLocal(station.truth);
        return {
          ...station,
          startedAtIso: new Date(station.startedAt).toISOString(),
          truthUncertaintyMetres: TRUTH_CONFIDENCE[station.truth.confidence].metres,
          pointedAt: {
            local,
            wgs84: localToWgs84(local),
            /* The georeference fit solves in plan metres, so the file carries
               the frame that survives a change of origin or bearing. */
            planMetres: localToPlanMetres(local),
          },
          summary: report.summary,
          residual: report.residual,
        };
      }),
      track: state.track,
      trackTruncated: state.trackTruncated,
    },
    null,
    2,
  );
}
