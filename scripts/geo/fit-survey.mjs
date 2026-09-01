#!/usr/bin/env node
/**
 * Solve the georeference from field measurements.
 *
 *   node scripts/geo/fit-survey.mjs tmp/survey/2026-09-02.json
 *
 * Input is what /survey writes. Each station carries the plan metres of the
 * point that was pointed at and the median of the fixes taken there, so the fit
 * runs in plan space and stays valid if the origin or the bearing moves.
 *
 * Plan metres -> local ENU is a reflection (+z runs down the drawing sheet),
 * and a reflection composed with the unknown rotation is again a rotation:
 * with q = (x, -z) the model is `measured = s * Rot(-bearing) * q + t`, an
 * ordinary 2D Helmert fit with a closed form. Solving the reflected form
 * directly is what would put the campus back to front.
 *
 * The scale is NOT a free parameter in the answer this prints first:
 * docs/floor-map-3d.md §3.1 pins it at 9.3 m/unit from three independent
 * measurements, and a handful of GNSS points is far weaker evidence than that.
 * The free-scale solution is printed underneath as a diagnostic — if it comes
 * back far from 1.000 the measurements disagree with the drawing about
 * distance, which is a finding, not a correction to apply.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const coordinates = JSON.parse(
  readFileSync(path.join(here, "../../src/lib/map/toyosu-campus.coordinates.json"), "utf8"),
);

const R = coordinates.localToWgs84.earthRadiusMetres;
const ORIGIN = { lat: coordinates.origin.lat, lon: coordinates.origin.lon };
const LAT_COS = Math.cos((ORIGIN.lat * Math.PI) / 180);
const DEG = 180 / Math.PI;

function wgs84ToLocal({ lat, lon }) {
  return {
    east: ((lon - ORIGIN.lon) / DEG) * R * LAT_COS,
    north: ((lat - ORIGIN.lat) / DEG) * R,
  };
}

function localToWgs84({ east, north }) {
  return { lat: ORIGIN.lat + (north / R) * DEG, lon: ORIGIN.lon + (east / (R * LAT_COS)) * DEG };
}

function percentile(values, fraction) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(Math.max(Math.ceil(fraction * sorted.length), 1), sorted.length) - 1];
}

/**
 * Closed-form similarity fit. `freeScale = false` keeps s at 1 and solves only
 * rotation and translation, which is the version the drawing's fixed scale
 * entitles us to.
 */
function helmert(source, measured, freeScale) {
  const n = source.length;
  const mean = (points, key) => points.reduce((sum, point) => sum + point[key], 0) / n;
  const sourceMean = { x: mean(source, "x"), y: mean(source, "y") };
  const measuredMean = { x: mean(measured, "x"), y: mean(measured, "y") };
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let index = 0; index < n; index += 1) {
    const sx = source[index].x - sourceMean.x;
    const sy = source[index].y - sourceMean.y;
    const mx = measured[index].x - measuredMean.x;
    const my = measured[index].y - measuredMean.y;
    dot += sx * mx + sy * my;
    cross += sx * my - sy * mx;
    norm += sx * sx + sy * sy;
  }
  // One point fixes a translation and nothing else, so the bearing stays where
  // the drawing put it rather than collapsing to zero.
  const theta =
    n > 1 && norm > 0 ? Math.atan2(cross, dot) : -(coordinates.planToLocal.northBearingDeg * Math.PI) / 180;
  const scale = freeScale && norm > 0 ? Math.hypot(dot, cross) / norm : 1;
  const apply = (point) => ({
    x: scale * (point.x * Math.cos(theta) - point.y * Math.sin(theta)),
    y: scale * (point.x * Math.sin(theta) + point.y * Math.cos(theta)),
  });
  const rotatedMean = apply(sourceMean);
  const translation = { x: measuredMean.x - rotatedMean.x, y: measuredMean.y - rotatedMean.y };
  return {
    theta,
    scale,
    project: (point) => {
      const rotated = apply(point);
      return { x: rotated.x + translation.x, y: rotated.y + translation.y };
    },
  };
}

function report(label, stations, freeScale) {
  const source = stations.map((station) => ({ x: station.plan.x, y: -station.plan.z }));
  const measured = stations.map((station) => ({ x: station.measured.east, y: station.measured.north }));
  const fit = helmert(source, measured, freeScale);
  const residuals = stations.map((station, index) => {
    const projected = fit.project(source[index]);
    return {
      label: station.label,
      truth: station.truthUncertainty,
      distance: Math.hypot(projected.x - measured[index].x, projected.y - measured[index].y),
    };
  });
  const distances = residuals.map((entry) => entry.distance);
  const bearing = (((-fit.theta * DEG) % 360) + 360) % 360;
  const planOrigin = coordinates.planToLocal.planOriginMetres;
  const projectedOrigin = fit.project({ x: planOrigin.x, y: -planOrigin.z });
  const fittedOrigin = localToWgs84({ east: projectedOrigin.x, north: projectedOrigin.y });

  console.log(`\n== ${label} ==`);
  console.log(
    `  真北ベアリング   ${bearing.toFixed(2)}°  (現行 ${coordinates.planToLocal.northBearingDeg}°, 差 ${(bearing - coordinates.planToLocal.northBearingDeg).toFixed(2)}°)`,
  );
  if (freeScale) {
    console.log(`  スケール係数     ${fit.scale.toFixed(4)}  → ${(coordinates.scale.metresPerUnit * fit.scale).toFixed(3)} m/unit`);
  }
  console.log(`  原点 lat/lon     ${fittedOrigin.lat.toFixed(7)}, ${fittedOrigin.lon.toFixed(7)}`);
  console.log(`  原点の移動量     ${Math.hypot(projectedOrigin.x, projectedOrigin.y).toFixed(2)} m`);
  console.log(
    `  残差 平均/p95/最大 ${(distances.reduce((sum, value) => sum + value, 0) / distances.length).toFixed(2)} / ${percentile(distances, 0.95).toFixed(2)} / ${Math.max(...distances).toFixed(2)} m`,
  );
  for (const entry of [...residuals].sort((a, b) => b.distance - a.distance)) {
    // A residual smaller than the pointing error is not a transform error.
    const verdict = entry.distance <= entry.truth ? "  (指し示し誤差の範囲内)" : "";
    console.log(`    ${entry.distance.toFixed(2).padStart(6)} m  ${entry.label}${verdict}`);
  }
  return { bearing, fittedOrigin, scale: fit.scale };
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/geo/fit-survey.mjs <survey-export.json>");
  process.exit(1);
}

const survey = JSON.parse(readFileSync(file, "utf8"));
if (survey.coordinateVersion !== coordinates.coordinateVersion) {
  console.warn(
    `warning: 測定時の座標版 ${survey.coordinateVersion} と現行 ${coordinates.coordinateVersion} が違います。plan metres 基準なので原点・方位の変更は問題ありませんが、図面が引き直されていれば無効です。`,
  );
}

const stations = (survey.stations ?? [])
  .filter((station) => station.pointedAt?.planMetres && station.summary)
  .map((station) => ({
    label: `${station.label} (${station.truth.level}F) n=${station.summary.count} ばらつき${station.summary.spreadP95.toFixed(1)}m 正解±${station.truthUncertaintyMetres}m`,
    level: station.truth.level,
    truthUncertainty: station.truthUncertaintyMetres,
    plan: station.pointedAt.planMetres,
    measured: wgs84ToLocal(station.summary.wgs84),
  }));

console.log(`${stations.length} 点（${[...new Set(stations.map((s) => s.level))].sort((a, b) => a - b).join("F, ")}F）`);
if (stations.length === 0) {
  console.error("測定がありません。");
  process.exit(1);
}

const primary = report(
  stations.length === 1 ? "平行移動のみ（1点では方位は解けません）" : "スケール固定（推奨）",
  stations,
  false,
);
if (stations.length >= 3) report("スケール自由（診断用。採用しないこと）", stations, true);

console.log(`
coordinates.json へは上書きではなく新しい版を足すこと（JSON 冒頭の $comment）:

  "coordinateVersion": "toyosu-<yyyy-mm-dd>.1",
  "origin": { "lat": ${primary.fittedOrigin.lat.toFixed(7)}, "lon": ${primary.fittedOrigin.lon.toFixed(7)}, ... },
  "planToLocal": { "northBearingDeg": ${primary.bearing.toFixed(2)}, ... }

origin.source と origin.uncertaintyMetres も書き換えること。実測に置き換われば
「on-site knowledge, NOT the drawing」の 2.5m は測定のばらつきに変わります。`);
