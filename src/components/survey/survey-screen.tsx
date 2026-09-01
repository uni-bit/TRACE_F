"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  COORDINATE_VERSION,
  METRES_PER_PLAN_PX,
  NORTH_BEARING_DEG,
  bearingDeg,
  distanceMetres,
  insideGeofence,
  localToPlanPx,
  planPxToLocal,
  planPxToWgs84,
  wgs84ToLocal,
  type LocalEnu,
} from "@/lib/geo/campus-georeference";
import {
  TRUTH_CONFIDENCE,
  appendTrack,
  emptySurvey,
  loadSurvey,
  reportFor,
  saveSurvey,
  summarize,
  toExport,
  toFix,
  totals,
  truthLocal,
  type Fix,
  type GroundTruth,
  type SurveyState,
  type TruthConfidence,
} from "@/lib/geo/survey-log";
import { withBasePath } from "@/lib/base-path";
import { toyosuClassroom } from "@/lib/map/buildings";
import { LEVEL_HEIGHT, METRES_PER_UNIT } from "@/lib/map/plan-transform";

/**
 * Staff instrument for the 9/2 site visit. Not part of the participant flow:
 * nothing links here and it never touches `ExperienceProvider`, so no consent
 * gate applies to it and none is bypassed either. The position it reads never
 * leaves the device — no request, no URL, no log — which is the line
 * frontend-design.md §7.3 draws for the participant's own GPS and which holds
 * here for the same reason.
 *
 * The screen answers one question: put a browser fix through the campus
 * transform, and does it land where you are standing? Answering it needs a
 * truth, and there is no survey instrument, so the truth is the surveyor
 * pointing at the floor plan. Everything here exists to make that pointing
 * precise and to record how precise it could be.
 *
 * Pointing is a tap plus nudge buttons rather than a crosshair fixed to the
 * centre of a scrolling plan. The fixed crosshair reads better but stops
 * working at the zoom that fits the plan to the screen: with nothing to scroll,
 * the crosshair cannot leave the middle of the drawing. A tap places the mark
 * anywhere, and the nudges — one plan pixel is 6 cm — get past the width of a
 * finger without needing to zoom in first.
 */

const PLAN = toyosuClassroom.plan;
/** The pitch a floor has to clear to be told apart by altitude. */
const STOREY_METRES = LEVEL_HEIGHT * METRES_PER_UNIT;
const SAMPLE_SECONDS = [30, 60, 120];
const GEOFENCE_MARGIN_METRES = 15;
const ZOOM_LIMITS = { min: 0.12, max: 6 };
const NUDGES = [1, 5, 20];

interface Sampling {
  truth: GroundTruth;
  label: string;
  note: string;
  startedAt: number;
  seconds: number;
  fixes: Fix[];
}

/** A zero-width viewport (hidden tab, odd embed) must not produce a zoom of 0. */
function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, value));
}

function metres(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)} m` : "—";
}

function degrees(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value).toString().padStart(3, "0")}°`
    : "—";
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("ja-JP", { hour12: false });
}

export function SurveyScreen() {
  const [state, setState] = useState<SurveyState>(loadSurvey);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<Fix | null>(null);
  const [sampling, setSampling] = useState<Sampling | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [floorId, setFloorId] = useState(toyosuClassroom.floors[0].id);
  // Fit the plan width on first paint. Safe to read `window` here: this
  // component is only ever loaded client-side (see survey-client.tsx).
  const [zoom, setZoom] = useState(() => clampZoom((window.innerWidth - 44) / PLAN.widthPx));
  const [mark, setMark] = useState({ x: PLAN.widthPx / 2, y: PLAN.heightPx / 2 });

  const [label, setLabel] = useState("");
  const [confidence, setConfidence] = useState<TruthConfidence>("feature");
  const [note, setNote] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [showExport, setShowExport] = useState(false);

  const watchId = useRef<number | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const floor = toyosuClassroom.floors.find((candidate) => candidate.id === floorId) ?? toyosuClassroom.floors[0];

  // Serializing on every fix would be a needless megabyte a minute, so the log
  // is written on a timer, when the screen goes away, and when the phone is
  // pocketed — the moment field data actually gets lost.
  useEffect(() => {
    const flush = () => saveSurvey(stateRef.current);
    const timer = window.setInterval(flush, 5000);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const handlePosition = useCallback((position: GeolocationPosition) => {
    const fix = toFix(position);
    setLatest(fix);
    setState((current) => appendTrack(current, fix));
    setSampling((current) => (current ? { ...current, fixes: [...current.fixes, fix] } : current));
  }, []);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setError("この端末は Geolocation API を持っていません。");
      return;
    }
    setError(null);
    setWatching(true);
    watchId.current = navigator.geolocation.watchPosition(
      handlePosition,
      (positionError) => {
        setWatching(false);
        setError(`${positionError.message}（code ${positionError.code}）`);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, [handlePosition]);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setWatching(false);
  }, []);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  const finishSampling = useCallback((current: Sampling) => {
    // A window that collected nothing is not a measurement. Recording it would
    // put a station on the map with no altitude and no position, which reads
    // exactly like the finding we are here to look for — a floor the device
    // cannot give a height for — when all it means is that the fix dropped out.
    if (current.fixes.length === 0) {
      setError(`${current.seconds}秒のあいだ fix が1件も届きませんでした。この地点は記録していません。`);
      setSampling(null);
      return;
    }
    setState((previous) => ({
      ...previous,
      stations: [
        ...previous.stations,
        {
          id: `st-${current.startedAt}`,
          label: current.label || "(無名地点)",
          truth: current.truth,
          note: current.note,
          startedAt: current.startedAt,
          endedAt: Date.now(),
          fixes: current.fixes,
        },
      ],
    }));
    setSampling(null);
  }, []);

  // Rescheduled on every fix so the timer closes over the full sample; the
  // deadline itself does not move, so nothing drifts.
  useEffect(() => {
    if (!sampling) return;
    const remaining = sampling.startedAt + sampling.seconds * 1000 - Date.now();
    const timer = window.setTimeout(() => finishSampling(sampling), Math.max(remaining, 0));
    return () => window.clearTimeout(timer);
  }, [sampling, finishSampling]);

  /** Screen point -> plan pixel, straight off the rendered box. */
  const placeMark = (event: React.MouseEvent<HTMLDivElement>) => {
    const element = canvas.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setMark({
      x: Math.min(PLAN.widthPx, Math.max(0, ((event.clientX - box.left) / box.width) * PLAN.widthPx)),
      y: Math.min(PLAN.heightPx, Math.max(0, ((event.clientY - box.top) / box.height) * PLAN.heightPx)),
    });
  };

  const nudge = (dx: number, dy: number) =>
    setMark((current) => ({
      x: Math.min(PLAN.widthPx, Math.max(0, current.x + dx)),
      y: Math.min(PLAN.heightPx, Math.max(0, current.y + dy)),
    }));

  const current: LocalEnu | null = latest ? wgs84ToLocal({ lat: latest.lat, lon: latest.lon }) : null;
  const currentPx = current ? localToPlanPx(toyosuClassroom.id, current) : null;
  const markLocal = planPxToLocal({ buildingId: toyosuClassroom.id, ...mark });
  const markWgs = planPxToWgs84({ buildingId: toyosuClassroom.id, ...mark });
  const offset = current ? distanceMetres(current, markLocal) : null;

  const reports = useMemo(() => state.stations.map(reportFor), [state.stations]);
  const summary = useMemo(() => totals(state), [state]);
  const samplingSummary = sampling ? summarize(sampling.fixes) : null;
  const exportText = useMemo(() => (showExport ? toExport(state) : ""), [showExport, state]);
  /** Ground distance per screen pixel — how finely a tap alone can land. */
  const tapResolution = METRES_PER_PLAN_PX / zoom;

  const download = () => {
    const blob = new Blob([toExport(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trace-position-survey-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="survey">
      <header className="survey-head">
        <div>
          <p className="eyebrow">POSITION SURVEY / STAFF TOOL</p>
          <h1>位置の実測</h1>
          <p className="survey-sub">
            座標版 <code>{COORDINATE_VERSION}</code>／図面の上方向 = 真北 {NORTH_BEARING_DEG}°。
            参加者導線からは到達しません。位置はこの端末から出ません。
          </p>
        </div>
        <div className="survey-actions">
          {watching ? (
            <button className="button button-quiet" type="button" onClick={stopWatch}>測位を停止</button>
          ) : (
            <button className="button button-primary" type="button" onClick={startWatch}>測位を開始</button>
          )}
        </div>
      </header>

      {error && <p className="survey-error" role="status">{error}</p>}

      <section className="survey-card">
        <div className="survey-card-head">
          <h2>図面で自分の位置を指す</h2>
          <span className="survey-totals">タップして置く → ボタンで詰める</span>
        </div>

        <div className="survey-floor-row">
          <div className="survey-floors">
            {toyosuClassroom.floors.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`small-button ${candidate.id === floorId ? "is-active" : ""}`}
                onClick={() => setFloorId(candidate.id)}
              >{candidate.label}</button>
            ))}
          </div>
          <div className="survey-zoom">
            <button className="small-button" type="button" onClick={() => setZoom((value) => clampZoom(value / 1.6))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="small-button" type="button" onClick={() => setZoom((value) => clampZoom(value * 1.6))}>＋</button>
          </div>
        </div>

        <div className="survey-plan-viewport">
          <div
            className="survey-plan-canvas"
            ref={canvas}
            style={{ width: PLAN.widthPx * zoom, height: PLAN.heightPx * zoom }}
            onClick={placeMark}
            role="presentation"
          >
            <Image
              src={withBasePath(floor.texture)}
              alt={`${floor.label} ${toyosuClassroom.name}平面図`}
              width={PLAN.widthPx}
              height={PLAN.heightPx}
              unoptimized
              priority
              style={{ width: "100%", height: "100%" }}
            />
            <svg className="survey-plan-overlay" viewBox={`0 0 ${PLAN.widthPx} ${PLAN.heightPx}`} aria-hidden="true">
              {currentPx && latest && (
                <>
                  <circle className="survey-plot-accuracy" cx={currentPx.x} cy={currentPx.y} r={latest.accuracy / METRES_PER_PLAN_PX} />
                  <circle className="survey-plot-me" cx={currentPx.x} cy={currentPx.y} r={7 / zoom} />
                </>
              )}
              {reports.map((entry) =>
                entry.station.truth.floorId === floorId ? (
                  <rect
                    key={entry.station.id}
                    className="survey-plot-station"
                    x={entry.station.truth.x - 5 / zoom}
                    y={entry.station.truth.y - 5 / zoom}
                    width={10 / zoom}
                    height={10 / zoom}
                  />
                ) : null,
              )}
              <g className="survey-plot-mark">
                <line x1={mark.x} y1={mark.y - 22 / zoom} x2={mark.x} y2={mark.y + 22 / zoom} strokeWidth={1.5 / zoom} />
                <line x1={mark.x - 22 / zoom} y1={mark.y} x2={mark.x + 22 / zoom} y2={mark.y} strokeWidth={1.5 / zoom} />
                <circle cx={mark.x} cy={mark.y} r={6 / zoom} strokeWidth={1.5 / zoom} />
              </g>
            </svg>
          </div>
        </div>

        <div className="survey-nudge">
          <span>微調整</span>
          {NUDGES.map((step) => (
            <span key={step} className="survey-nudge-group">
              <button className="small-button" type="button" onClick={() => nudge(-step, 0)} aria-label={`左へ${step}px`}>←</button>
              <button className="small-button" type="button" onClick={() => nudge(0, -step)} aria-label={`上へ${step}px`}>↑</button>
              <button className="small-button" type="button" onClick={() => nudge(0, step)} aria-label={`下へ${step}px`}>↓</button>
              <button className="small-button" type="button" onClick={() => nudge(step, 0)} aria-label={`右へ${step}px`}>→</button>
              <small>{(step * METRES_PER_PLAN_PX).toFixed(2)}m</small>
            </span>
          ))}
        </div>

        <dl className="survey-readout">
          <div><dt>指した点</dt><dd>{floor.label} / px {Math.round(mark.x)}, {Math.round(mark.y)}</dd></div>
          <div><dt>その点の緯度経度</dt><dd>{markWgs.lat.toFixed(7)}, {markWgs.lon.toFixed(7)}</dd></div>
          <div><dt>画面1pxの細かさ</dt><dd className={tapResolution > 1 ? "is-warn" : ""}>{tapResolution.toFixed(2)} m<small>タップだけで詰められる限界。ボタンなら 6cm 単位</small></dd></div>
          {offset !== null && <div><dt>測位値とのずれ</dt><dd><strong>{metres(offset)}</strong></dd></div>}
        </dl>

        {currentPx && (
          <p className="survey-note">
            測位値は {floor.label} 図面上の px {Math.round(currentPx.x)}, {Math.round(currentPx.y)}
            {(currentPx.x < 0 || currentPx.x > PLAN.widthPx || currentPx.y < 0 || currentPx.y > PLAN.heightPx) && "（教室棟の図面の外）"}
          </p>
        )}
      </section>

      <section className="survey-grid">
        <article className="survey-card">
          <h2>いまの測位</h2>
          {latest && current ? (
            <dl className="survey-readout">
              <div><dt>緯度経度</dt><dd>{latest.lat.toFixed(7)}, {latest.lon.toFixed(7)}</dd></div>
              <div><dt>端末が申告する精度</dt><dd>{metres(latest.accuracy)}</dd></div>
              <div><dt>高度</dt><dd className={latest.altitude === null ? "is-warn" : ""}>{latest.altitude === null ? "返ってこない" : `${latest.altitude.toFixed(1)} m ±${latest.altitudeAccuracy?.toFixed(1) ?? "?"}`}</dd></div>
              <div><dt>ローカルENU</dt><dd>E {current.east.toFixed(1)} / N {current.north.toFixed(1)}</dd></div>
              <div><dt>ジオフェンス</dt><dd>{insideGeofence(current, GEOFENCE_MARGIN_METRES) ? `内側（+${GEOFENCE_MARGIN_METRES}m 余裕）` : "外側"}</dd></div>
              <div><dt>指した点への方位</dt><dd>{degrees(bearingDeg(current, markLocal))}</dd></div>
              <div><dt>最終更新</dt><dd>{clock(latest.t)}（{state.track.length} fix）</dd></div>
            </dl>
          ) : (
            <p className="survey-empty">{watching ? "最初の fix を待っています…" : "「測位を開始」で watchPosition を開始します。"}</p>
          )}
        </article>

        <article className="survey-card">
          <h2>この地点を記録する</h2>
          <label className="survey-field">
            <span>地点名</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例: 301教室 入口ドア枠の左端" />
          </label>
          <label className="survey-field">
            <span>どれくらい確かに指せたか</span>
            <select value={confidence} onChange={(event) => setConfidence(event.target.value as TruthConfidence)}>
              {(Object.keys(TRUTH_CONFIDENCE) as TruthConfidence[]).map((key) => (
                <option key={key} value={key}>{TRUTH_CONFIDENCE[key].label}（±{TRUTH_CONFIDENCE[key].metres}m）</option>
              ))}
            </select>
          </label>
          <label className="survey-field">
            <span>メモ</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="窓際、空の見え方、混雑など" />
          </label>
          <div className="survey-row">
            <span className="survey-note">{floor.label} / px {Math.round(mark.x)}, {Math.round(mark.y)}</span>
            <div className="survey-seconds">
              {SAMPLE_SECONDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`small-button ${seconds === value ? "is-active" : ""}`}
                  onClick={() => setSeconds(value)}
                >{value}秒</button>
              ))}
            </div>
          </div>
          {sampling ? (
            <div className="survey-sampling">
              <strong>
                サンプリング中 残り {Math.min(sampling.seconds, Math.max(0, Math.ceil(sampling.seconds - (now - sampling.startedAt) / 1000)))}秒
                ／ {sampling.fixes.length} fix
              </strong>
              {samplingSummary && (
                <small>
                  ばらつき p95 {metres(samplingSummary.spreadP95)} ／
                  指した点とのずれ {metres(distanceMetres(samplingSummary.local, truthLocal(sampling.truth)))}
                </small>
              )}
              <div className="button-row">
                <button className="button button-secondary" type="button" disabled={sampling.fixes.length === 0} onClick={() => finishSampling(sampling)}>いま確定</button>
                <button className="button button-quiet" type="button" onClick={() => setSampling(null)}>中止</button>
              </div>
            </div>
          ) : (
            <button
              className="button button-primary survey-wide"
              type="button"
              disabled={!watching}
              onClick={() =>
                setSampling({
                  truth: { floorId, level: floor.level, x: mark.x, y: mark.y, confidence },
                  label,
                  note,
                  startedAt: Date.now(),
                  seconds,
                  // Deliberately empty: the fix on screen was taken wherever you
                  // stood before walking here, and seeding the sample with it
                  // drags the median back to the last point.
                  fixes: [],
                })
              }
            >指した点で {seconds}秒 測る</button>
          )}
        </article>
      </section>

      <section className="survey-card">
        <div className="survey-card-head">
          <h2>測定結果</h2>
          <span className="survey-totals">
            {summary.scored} / 3 点・平均 {metres(summary.meanError, 2)}・p95 {metres(summary.p95Error, 2)}
          </span>
        </div>
        {reports.length === 0 ? (
          <p className="survey-empty">まだ測定がありません。coordinate-mapping.md は検証点3つ以上と p95 を求めています。</p>
        ) : (
          <div className="survey-table-scroll">
            <table className="survey-table">
              <thead>
                <tr><th>地点</th><th>階</th><th>fix</th><th>ばらつき</th><th>申告精度</th><th>ずれ</th><th>方位</th><th></th></tr>
              </thead>
              <tbody>
                {reports.map((entry) => (
                  <tr key={entry.station.id} className={entry.station.id === summary.worstStationId ? "is-worst" : ""}>
                    <td>
                      <strong>{entry.station.label}</strong>
                      <small>
                        {clock(entry.station.startedAt)} ・正解 ±{TRUTH_CONFIDENCE[entry.station.truth.confidence].metres}m
                        {entry.station.note ? ` ・${entry.station.note}` : ""}
                      </small>
                    </td>
                    <td>{entry.station.truth.level}F</td>
                    <td>{entry.summary?.count ?? 0}</td>
                    <td>{metres(entry.summary?.spreadP95)}</td>
                    <td>{metres(entry.summary?.reportedAccuracyMedian)}</td>
                    <td><strong>{metres(entry.residual?.distance, 2)}</strong></td>
                    <td>{degrees(entry.residual?.bearing)}</td>
                    <td>
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => setState((previous) => ({ ...previous, stations: previous.stations.filter((station) => station.id !== entry.station.id) }))}
                      >削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="survey-card">
        <div className="survey-card-head">
          <h2>階が分かれるか</h2>
          <span className="survey-totals">階高 {STOREY_METRES.toFixed(1)} m</span>
        </div>
        {summary.fixesTotal > 0 && summary.fixesWithoutAltitude === summary.fixesTotal ? (
          <p className="survey-empty is-warn">
            高度が1件も返っていません（{summary.fixesTotal} fix すべて <code>altitude: null</code>）。
            この端末・この場所では、Web から階を決める材料がありません。
          </p>
        ) : summary.floors.length === 0 ? (
          <p className="survey-empty">複数の階で測ると、高度が階を分けられるかが出ます。</p>
        ) : (
          <>
            <div className="survey-table-scroll">
              <table className="survey-table">
                <thead><tr><th>階</th><th>地点</th><th>高度の中央値</th><th>高度の申告精度</th></tr></thead>
                <tbody>
                  {summary.floors.map((entry) => (
                    <tr key={entry.level}>
                      <td><strong>{entry.label}</strong></td>
                      <td>{entry.stations}</td>
                      <td>{entry.altitudeMedian === null ? "返ってこない" : `${entry.altitudeMedian.toFixed(1)} m`}</td>
                      <td>{metres(entry.altitudeAccuracyMedian)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.smallestFloorGap !== null &&
              (summary.smallestFloorGap < STOREY_METRES / 2 ? (
                <p className="survey-note is-warn">
                  測った階のうち、いちばん近い2階の高度差は {metres(summary.smallestFloorGap)}。
                  階高 {STOREY_METRES.toFixed(1)} m の半分に届いていないので、
                  <strong>この測定では高度から階を決められません</strong>。
                </p>
              ) : (
                <p className="survey-note">
                  測った階のうち、いちばん近い2階の高度差は {metres(summary.smallestFloorGap)}。
                  階高 {STOREY_METRES.toFixed(1)} m に対して分離できています。
                  ただし高度の申告精度がこの差より大きければ、1回の測位では決められません。
                </p>
              ))}
          </>
        )}
      </section>

      <section className="survey-card">
        <h2>書き出し</h2>
        <div className="button-row">
          <button className="button button-primary" type="button" onClick={download}>JSONを保存</button>
          <button className="button button-secondary" type="button" onClick={() => void navigator.clipboard?.writeText(toExport(state))}>クリップボードへ</button>
          <button className="button button-secondary" type="button" onClick={() => setShowExport((value) => !value)}>{showExport ? "本文を隠す" : "本文を表示"}</button>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => {
              if (window.confirm("この端末に残した測定をすべて消します。書き出しは済んでいますか？")) {
                const cleared = emptySurvey();
                setState(cleared);
                saveSurvey(cleared);
              }
            }}
          >全消去</button>
        </div>
        <p className="survey-note">
          解析は <code>node scripts/geo/fit-survey.mjs &lt;書き出したJSON&gt;</code>。原点と真北を測定値から解き直し、
          残差の平均と p95 を出します。{state.trackTruncated && " ／ 軌跡は上限に達し、古い fix から捨てています。"}
        </p>
        {showExport && <textarea className="survey-export" readOnly value={exportText} rows={12} />}
      </section>
    </main>
  );
}
