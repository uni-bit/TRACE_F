"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-screen"><p className="eyebrow">TRACE / RECOVERY</p><h1>一時的に読み込めませんでした。</h1><p>もう一度試してください。保存済みの写真はこの端末から消えません。</p><button className="button button-primary" type="button" onClick={() => reset()}>もう一度試す</button></main>;
}
