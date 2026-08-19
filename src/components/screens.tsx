"use client";

/* Blob URLs are local, processed photo data; next/image cannot optimize them. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useExperience } from "@/components/experience-provider";
import type { ConsentState, Language, PhotoRecord } from "@/lib/trace-types";

const copy = {
  ja: {
    eyebrow: "参加者向けプロトタイプ / MOCK MODE",
    title: "歩いた時間を、|光の記憶へ。",
    intro: "TRACEは、あなたが歩いた道と残した写真を、会場でひとつの風景に変換する参加型体験です。",
    start: "体験をはじめる",
    demo: "デモ到着を試す",
    memory: "写真Memory",
    live: "Live位置",
    memoryDesc: "撮影した写真を、あとで自分だけのストーリーとして見返します。",
    liveDesc: "歩いている間の最新位置だけを会場の演出へ届けます。",
    consent: "同意と参加方法",
    continue: "選択して続ける",
    experience: "体験中",
    arrival: "到着",
    waiting: "待機",
    story: "写真ストーリー",
    data: "データ管理",
    alternative: "別の参加方法",
  },
  en: {
    eyebrow: "PARTICIPANT PROTOTYPE / MOCK MODE",
    title: "Turn the time you walked|into a trace of light.",
    intro: "TRACE transforms your path and photographs into one shared landscape at the venue.",
    start: "Start the experience",
    demo: "Try demo arrival",
    memory: "Photo Memory",
    live: "Live location",
    memoryDesc: "Keep processed photographs as a private story for yourself.",
    liveDesc: "Share only the latest location while you choose to walk.",
    consent: "Consent and participation",
    continue: "Continue with selection",
    experience: "Experience",
    arrival: "Arrival",
    waiting: "Waiting",
    story: "Photo story",
    data: "Data settings",
    alternative: "Alternative",
  },
} as const;

function useCopy() {
  const { language } = useExperience();
  return copy[language];
}

export function LanguageToggle() {
  const { language, setLanguage } = useExperience();
  return <div className="language-toggle" role="group" aria-label="Language">
    {(["ja", "en"] as Language[]).map((option) => <button key={option} type="button" className={language === option ? "is-active" : ""} onClick={() => setLanguage(option)} aria-pressed={language === option}>{option.toUpperCase()}</button>)}
  </div>;
}

export function TraceHeader() {
  const c = useCopy();
  return <header className="site-header">
    <Link href="/" className="wordmark" aria-label="TRACE home"><span className="wordmark-mark">✦</span> TRACE</Link>
    <nav className="top-nav" aria-label="Main navigation">
      <Link href="/map">3D Map</Link><Link href="/memory">{c.story}</Link><Link href="/settings/data">{c.data}</Link><LanguageToggle />
    </nav>
  </header>;
}

function MockTools() {
  const { setNextUploadFailure } = useExperience();
  return <button className="small-button mock-tool" type="button" onClick={setNextUploadFailure}>次回写真通信断を再現</button>;
}

export function Shell({ children, label }: { children: React.ReactNode; label?: string }) {
  return <div className="app-shell"><TraceHeader /><main className="page-shell" aria-label={label}>{children}</main><footer className="site-footer"><span>TRACE / campus installation</span><span>MOCK API · no external tracking</span><MockTools /></footer></div>;
}

export function HomeScreen() {
  const c = useCopy();
  return <Shell label="TRACE">
    <section className="hero-grid">
      <div className="hero-copy">
        <p className="eyebrow">{c.eyebrow}</p>
        <h1>{c.title.split("|").map((line) => <span key={line}>{line}<br /></span>)}</h1>
        <p className="lede">{c.intro}</p>
        <div className="button-row"><Link className="button button-primary" href="/consent">{c.start}<span aria-hidden="true">→</span></Link><Link className="button button-quiet" href="/arrival#checkpointToken=demo-arrival">{c.demo}</Link></div>
        <p className="micro-note"><span className="status-dot" aria-hidden="true" /> ブラウザ内モックで、撮影から到着まで確認できます。</p>
      </div>
      <div className="hero-art" aria-label="抽象化された光の経路" role="img"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit orbit-three" /><span className="hero-star">✦</span><span className="hero-caption">YOUR PATH<br /><strong>BECOMES LIGHT</strong></span></div>
    </section>
    <section className="feature-strip"><div><span className="feature-index">01</span><strong>記憶を残す</strong><p>加工済みの写真だけを、あなたの端末とMemoryへ。</p></div><div><span className="feature-index">02</span><strong>歩く</strong><p>Liveは明示的に始めたときだけ、最新位置を送ります。</p></div><div><span className="feature-index">03</span><strong>会場で出会う</strong><p>到着すると、あなたの軌跡が抽象的な演出になります。</p></div></section>
  </Shell>;
}

export function ConsentScreen() {
  const c = useCopy();
  const router = useRouter();
  const { consent, setConsent, ensureSession, message, setMessage } = useExperience();
  const { memory, live, camera, singleLocation, liveLocation } = consent;
  const [busy, setBusy] = useState(false);
  const updateConsent = (patch: Partial<ConsentState>) => setConsent({ ...consent, ...patch });
  const submit = async () => {
    if (!memory && !live) { setMessage("写真MemoryかLive位置のどちらかを選択してください。"); return; }
    if (!camera && memory) { setMessage("写真Memoryを選ぶ場合は、カメラ利用への同意が必要です。"); return; }
    if (!liveLocation && live) { setMessage("Live位置を選ぶ場合は、位置利用への同意が必要です。"); return; }
    setBusy(true);
    try {
      await ensureSession(memory, live);
      router.push("/experience");
    } catch {
      setMessage("参加準備に失敗しました。通信状態を確認してもう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };
  return <Shell label={c.consent}><div className="section-heading"><p className="eyebrow">STEP 01 / CONSENT</p><h1>{c.consent}</h1><p>参加する機能を自分で選べます。権限のリクエストは、この同意を完了してボタンを押した後だけ行われます。</p></div>
    <div className="consent-layout"><div className="choice-stack">
      <label className={`choice-card ${memory ? "is-selected" : ""}`}><input type="checkbox" checked={memory} onChange={(event) => updateConsent({ memory: event.target.checked })} /><span className="choice-icon">◌</span><span><strong>{c.memory}</strong><small>{c.memoryDesc}</small></span><span className="choice-check" aria-hidden="true">{memory ? "✓" : ""}</span></label>
      <label className={`choice-card ${live ? "is-selected" : ""}`}><input type="checkbox" checked={live} onChange={(event) => updateConsent({ live: event.target.checked })} /><span className="choice-icon">⌁</span><span><strong>{c.live}</strong><small>{c.liveDesc}</small></span><span className="choice-check" aria-hidden="true">{live ? "✓" : ""}</span></label>
    </div><aside className="consent-panel"><h2>個別の同意</h2><label className="check-row"><input type="checkbox" checked={camera} onChange={(event) => updateConsent({ camera: event.target.checked })} /><span><strong>カメラを使う</strong><small>撮影した元画像は保持・送信せず、端末で加工します。</small></span></label><label className="check-row"><input type="checkbox" checked={singleLocation} onChange={(event) => updateConsent({ singleLocation: event.target.checked })} /><span><strong>撮影時の単発位置を使う</strong><small>写真を撮る瞬間だけ位置を取得し、写真レコードに含めます。</small></span></label><label className="check-row"><input type="checkbox" checked={liveLocation} onChange={(event) => updateConsent({ liveLocation: event.target.checked })} /><span><strong>Live位置を使う</strong><small>明示的に開始している間だけ、最新1点を送信します。</small></span></label><div className="privacy-callout"><span aria-hidden="true">◈</span><p>正確な現在地の履歴や、原写真を公開スクリーンへ渡しません。</p></div><button className="button button-primary button-wide" type="button" onClick={() => void submit()} disabled={busy}>{busy ? "準備中…" : c.continue}<span aria-hidden="true">→</span></button>{message && <p className="inline-message" role="alert">{message}</p>}</aside></div>
  </Shell>;
}

export function ExperienceScreen() {
  const c = useCopy();
  const { snapshot, photos, localUsage, consent, liveControllerActive, startLive, startDemoLive, stopLive, capturePhoto, retryPhoto, deletePhoto, message, setMessage } = useExperience();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onPhoto = async (file: File | undefined) => { if (!file) return; const capturedAt = new Date().toISOString(); setBusy(true); try { await capturePhoto(file, capturedAt); } catch { setMessage("写真の加工に失敗しました。別の写真を試してください。"); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; } };
  return <Shell label={c.experience}><div className="section-heading compact"><p className="eyebrow">STEP 02 / IN MOTION</p><h1>{c.experience}</h1><p>歩いた時間を、いくつかの小さな操作で記録します。Live位置はこの画面で開始したときだけ動きます。</p></div><div className="status-grid"><article className={`status-card ${liveControllerActive ? "is-live" : ""}`}><span className="status-kicker">LIVE PRESENCE</span><strong>{liveControllerActive ? "送信中" : snapshot.trackingStatus === "tracking" ? "再開待ち" : snapshot.trackingStatus === "stopped" ? "停止中" : "未参加"}</strong><p>{liveControllerActive ? "最新の位置だけを送信しています。" : snapshot.trackingStatus === "tracking" ? "再読み込み後は端末の位置watchが停止しています。明示的に再開してください。" : snapshot.liveEnabled ? "Live位置を開始すると、最新位置だけを送信します。" : "Live位置には参加していません。"}</p><div className="button-row"><button className="button button-secondary" type="button" onClick={() => void startLive()} disabled={!snapshot.liveEnabled || liveControllerActive}>{snapshot.trackingStatus === "tracking" ? "端末Liveを再開" : "Liveを開始"}</button><button className="button button-secondary" type="button" onClick={() => void startDemoLive()} disabled={!snapshot.liveEnabled || liveControllerActive}>デモLiveを開始</button><button className="button button-quiet" type="button" onClick={() => void stopLive()} disabled={snapshot.trackingStatus !== "tracking"}>停止</button></div>{snapshot.lastLiveSentAt && <small className="success-text" aria-live="polite">最終送信 {new Date(snapshot.lastLiveSentAt).toLocaleTimeString("ja-JP")}</small>}</article><article className="status-card photo-card"><span className="status-kicker">PHOTO MEMORY</span><strong>{photos.length} / 12 枚</strong><p>加工済みJPEGのみを端末キューへ保存。使用量 {Math.round(localUsage.bytes / 1024)}KB / 30MB</p><label className="button button-primary file-button">{busy ? "加工中…" : "写真を撮る"}<input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={(event) => void onPhoto(event.target.files?.[0])} disabled={busy} /></label><small>{consent.singleLocation ? "単発撮影時に位置情報を取得します。" : "単発位置に同意していないため、写真には位置情報を含めません。"}</small></article></div><div className="section-divider"><h2>今の写真</h2><Link href="/memory" className="text-link">ストーリーを見る →</Link></div><div className="photo-grid">{photos.length === 0 ? <div className="empty-state"><span aria-hidden="true">◎</span><p>まだ写真はありません。歩きながら、残したい瞬間を一枚。</p></div> : photos.map((photo) => <PhotoTile key={photo.clientPhotoId} photo={photo} onRetry={() => void retryPhoto(photo)} onDelete={() => void deletePhoto(photo.clientPhotoId)} />)}</div>{message && <p className="live-region" role="status" aria-live="polite">{message}</p>}</Shell>;
}

function PhotoTile({ photo, onRetry, onDelete }: { photo: PhotoRecord & { url: string }; onRetry: () => void; onDelete: () => void }) {
  return <article className="photo-tile"><img src={photo.url} alt="加工済みの参加者写真" /><div className="photo-meta"><span className={`photo-status status-${photo.status}`}>{photo.status === "ready" ? "保存済み" : photo.status === "retry_wait" ? "再送待ち" : photo.status === "failed" ? "処理失敗" : `${photo.progress}%`}</span><button className="icon-button" type="button" onClick={onDelete} aria-label="写真を削除">×</button></div>{photo.status === "retry_wait" && <button className="small-button" type="button" onClick={onRetry}>再送する</button>}</article>;
}

export function ArrivalScreen() {
  const c = useCopy();
  const { registerArrival, snapshot, message, setMessage } = useExperience();
  const [proof, setProof] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const hash = window.location.hash;
    const value = new URLSearchParams(hash.replace(/^#/, "")).get("checkpointToken");
    if (value) { queueMicrotask(() => setProof(value)); window.history.replaceState(null, "", "/arrival"); }
  }, []);
  const register = async () => {
    if (!proof) { setMessage("到着証明がありません。デモ到着を受け取るか、QRから開いてください。"); return; }
    setBusy(true);
    try { await registerArrival(proof); } catch { setMessage("到着登録に失敗しました。"); } finally { setBusy(false); }
  };
  const demo = () => { setProof("demo-arrival"); setMessage("デモ到着証明を受け取りました。登録できます。"); };
  return <Shell label={c.arrival}><div className="section-heading"><p className="eyebrow">STEP 03 / CHECKPOINT</p><h1>{c.arrival}</h1><p>会場のQRから受け取った証明を、このタブの参加体験へ冪等に登録します。証明はURLからすぐに消去されます。</p></div><div className="arrival-card"><div className="qr-visual" aria-hidden="true"><span>✦</span></div><div><span className="status-kicker">CHECKPOINT STATUS</span><h2>{snapshot.arrivalRegistered ? "到着登録済み" : proof ? "証明を受け取りました" : "QRを読み取ってください"}</h2><p>{snapshot.arrivalRegistered ? "到着後の体験を選べます。" : proof ? "このタブのcredentialだけで登録します。" : "デモボタンでも同じ導線を確認できます。"}</p><div className="button-row"><button className="button button-primary" type="button" onClick={() => void register()} disabled={busy || !proof}>{busy ? "登録中…" : "到着を登録"}</button><button className="button button-quiet" type="button" onClick={demo}>デモ到着を受け取る</button></div></div></div>{snapshot.arrivalRegistered && <div className="next-step"><span className="symbol-badge" style={{ backgroundColor: snapshot.arrivalColor }}>{snapshot.arrivalSymbol}</span><div><strong>次は待機画面へ</strong><p>あなたの色と記号は会場でこの組み合わせになります。</p></div><Link className="button button-secondary" href="/arrival/waiting">待機へ進む →</Link></div>}{message && <p className="live-region" role="status" aria-live="polite">{message}</p>}</Shell>;
}

export function WaitingScreen() {
  const c = useCopy();
  const { snapshot, liveControllerActive, refreshArrival, skipReplay, startLive, startDemoLive, stopLive, setOnSite, message, setMessage } = useExperience();
  const [onSiteConsent, setOnSiteConsent] = useState(false);
  useEffect(() => { void refreshArrival(); const timer = window.setInterval(() => void refreshArrival(), 1800); return () => window.clearInterval(timer); }, [refreshArrival]);
  const enterOnSite = async () => {
    if (!onSiteConsent) { setMessage("会場内モードの追加同意を確認してください。"); return; }
    try { await setOnSite(); } catch { setMessage("会場内モードへ切り替えられませんでした。到着とLive参加を確認してください。"); }
  };
  return <Shell label={c.waiting}><div className="section-heading compact"><p className="eyebrow">STEP 04 / WAITING ROOM</p><h1>{c.waiting}</h1><p>会場の演出があなたの到着を受け取り、準備しています。</p></div><div className="waiting-stage"><div className="stage-symbol" style={{ backgroundColor: snapshot.arrivalColor }}>{snapshot.arrivalSymbol}</div><span className="stage-ring" style={{ borderColor: snapshot.arrivalColor }} /><div className="stage-copy"><span className="status-kicker">YOUR TRACE</span><h2>{snapshot.replayStatus === "queued" ? "演出を準備中" : snapshot.replayStatus === "playing" ? "演出が動いています" : snapshot.replayStatus === "completed" ? "演出が完了しました" : snapshot.replayStatus === "skipped" ? "演出をスキップしました" : "到着を確認中"}</h2><p>色 <strong style={{ color: snapshot.arrivalColor }}>●</strong> と記号 <strong>{snapshot.arrivalSymbol}</strong> で自分の演出を見つけられます。</p><div className="button-row"><button className="button button-primary" type="button" onClick={() => void skipReplay()} disabled={snapshot.replayStatus === "completed" || snapshot.replayStatus === "skipped"}>演出をスキップ</button>{snapshot.liveEnabled && !liveControllerActive && <><button className="button button-secondary" type="button" onClick={() => void startLive()}>端末Liveを再開</button><button className="button button-secondary" type="button" onClick={() => void startDemoLive()}>デモLiveを再開</button></>}{snapshot.liveEnabled && <button className="button button-quiet" type="button" onClick={() => void stopLive()} disabled={snapshot.trackingStatus !== "tracking"}>Liveを停止</button>}</div>{snapshot.liveEnabled ? <><p>{liveControllerActive ? "Live位置は送信中です。" : "会場内モードへ進む前に、この画面でLive位置を再開してください。"}</p><label className="check-row on-site-consent"><input type="checkbox" checked={onSiteConsent} onChange={(event) => setOnSiteConsent(event.target.checked)} /><span><strong>会場内モードに追加同意する</strong><small>到着後もLive位置を継続し、会場内の演出へ参加します。Live停止は別操作です。</small></span></label><button className="button button-secondary" type="button" onClick={() => void enterOnSite()} disabled={snapshot.presencePhase === "on_site" || !liveControllerActive}>会場内モードへ</button></> : <p>Memory-only参加では、会場内Live位置を利用しません。</p>}</div></div>{message && <p className="live-region" role="status" aria-live="polite">{message}</p>}<div className="section-divider"><h2>次にできること</h2><Link className="text-link" href="/memory">写真ストーリーへ →</Link></div></Shell>;
}

export function MemoryScreen() {
  const c = useCopy();
  const { photos, deletePhoto, snapshot, message } = useExperience();
  return <Shell label={c.story}><div className="section-heading"><p className="eyebrow">PRIVATE MEMORY</p><h1>{c.story}</h1><p>ここに表示されるのは、このタブで加工した写真だけです。推定経路は写真と写真の間を静かにつなぎます。</p></div><div className="route-line"><span className="route-node">01</span><span className="route-track" /><span className="route-node">02</span><span className="route-track route-track-short" /><span className="route-node">✦</span><span className="route-label">推定経路 / ESTIMATED TRACE</span></div><div className="story-grid">{photos.length === 0 ? <div className="empty-state large"><span aria-hidden="true">◌</span><h2>まだ記憶がありません</h2><p>体験中に写真を一枚撮ると、ここに自分だけのストーリーが始まります。</p><Link className="button button-primary" href="/experience">体験へ戻る →</Link></div> : photos.map((photo, index) => <article className="story-card" key={photo.clientPhotoId}><div className="story-number">{String(index + 1).padStart(2, "0")}</div><img src={photo.url} alt={`ストーリー写真 ${index + 1}`} /><div className="story-card-footer"><div><strong>{index === 0 ? "歩きはじめ" : index === photos.length - 1 ? "今ここ" : "途中の光"}</strong><small>{new Date(photo.capturedAt).toLocaleString("ja-JP")}</small></div><div className="button-row"><button className="small-button" type="button" onClick={() => void saveBlob(photo.url, `trace-memory-${index + 1}.jpg`)}>端末に保存</button><button className="icon-button" type="button" onClick={() => void deletePhoto(photo.clientPhotoId)} aria-label="写真を削除">×</button></div></div></article>)}</div>{snapshot.arrivalRegistered && <div className="story-complete"><span className="symbol-badge" style={{ backgroundColor: snapshot.arrivalColor }}>{snapshot.arrivalSymbol}</span><p>到着地点までの軌跡が、会場の光へつながりました。</p></div>}{message && <p className="live-region" role="status" aria-live="polite">{message}</p>}</Shell>;
}

async function saveBlob(url: string, filename: string): Promise<void> {
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
}

export function DataSettingsScreen() {
  const c = useCopy();
  const { stopLive, deleteMemory, deleteLive, deleteBoth, setNextBothFailure, snapshot, message, setMessage } = useExperience();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } catch { setMessage("操作に失敗しました。データは未完了の側を保持しています。"); } finally { setBusy(false); } };
  return <Shell label={c.data}><div className="section-heading"><p className="eyebrow">CONTROL YOUR DATA</p><h1>{c.data}</h1><p>追跡の停止と保存データの削除は別の操作です。削除に失敗した側だけを再試行できます。</p></div><div className="settings-list"><article className="settings-card"><div><span className="settings-icon">⌁</span><h2>Liveを停止</h2><p>現在の位置送信を止めます。写真Memoryは残ります。</p></div><button className="button button-secondary" type="button" disabled={busy} onClick={() => void run(stopLive)}>停止する</button></article><article className="settings-card danger-lite"><div><span className="settings-icon">◌</span><h2>Memoryを削除</h2><p>加工済み写真と写真Memoryの参加情報を削除します。</p></div><button className="button button-danger" type="button" disabled={busy} onClick={() => void run(deleteMemory)}>Memory削除</button></article><article className="settings-card danger-lite"><div><span className="settings-icon">⌁</span><h2>Liveを削除</h2><p>Live位置の参加情報を削除します。写真は残ります。</p></div><button className="button button-danger" type="button" disabled={busy} onClick={() => void run(deleteLive)}>Live削除</button></article><article className="settings-card danger-card"><div><span className="settings-icon">×</span><h2>両方を削除</h2><p>MemoryとLiveの両方を削除します。部分失敗時は成功側を復活させません。</p></div><div className="button-row"><button className="button button-quiet" type="button" onClick={setNextBothFailure}>次回Live失敗を再現</button><button className="button button-danger" type="button" disabled={busy} onClick={() => void run(deleteBoth)}>両方削除</button></div></article></div><div className="data-status"><span className="status-dot" aria-hidden="true" /><div><strong>{snapshot.trackingStatus === "tracking" ? "Live送信中" : "現在、Live送信は停止中"}</strong><p>この画面ではトークンを表示・共有しません。</p></div></div>{message && <p className="live-region" role="status" aria-live="polite">{message}</p>}</Shell>;
}

export function AlternativeScreen() {
  const c = useCopy();
  return <Shell label={c.alternative}><div className="alternative-hero"><span className="eyebrow">NO PERMISSION, NO PROBLEM</span><h1>見るだけでも、<br />TRACEの一部です。</h1><p>カメラや位置情報を使わなくても、会場の演出を観覧できます。参加方法はいつでも変更できます。</p><div className="button-row"><Link className="button button-primary" href="/arrival">到着画面へ</Link><Link className="button button-quiet" href="/">入口へ戻る</Link></div></div><div className="alternative-grid"><div><span>◎</span><h2>観覧する</h2><p>会場の光と音を、自分のペースで体験します。</p></div><div><span>□</span><h2>後から決める</h2><p>権限の選択は同意画面から明示的に行えます。</p></div></div></Shell>;
}
