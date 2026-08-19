import Link from "next/link";

export default function NotFound() {
  return <main className="error-screen"><p className="eyebrow">404 / TRACE</p><h1>そのページは見つかりません。</h1><p>入口へ戻って、体験の続きを選んでください。</p><Link className="button button-primary" href="/">入口へ戻る</Link></main>;
}
