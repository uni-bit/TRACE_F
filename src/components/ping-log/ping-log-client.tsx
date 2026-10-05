"use client";

import dynamic from "next/dynamic";

/**
 * The log screen lives on device APIs (notifications, camera, geolocation,
 * IndexedDB, localStorage) from its first render, so it is client-only.
 */
const PingLogScreen = dynamic(() => import("./ping-log-screen").then((module) => module.PingLogScreen), {
  ssr: false,
  loading: () => <main className="ping"><p className="ping-muted">読み込んでいます…</p></main>,
});

export function PingLogClient() {
  return <PingLogScreen />;
}
