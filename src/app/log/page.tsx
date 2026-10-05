import type { Metadata } from "next";

import { PingLogClient } from "@/components/ping-log/ping-log-client";
import { withBasePath } from "@/lib/base-path";

/** Prototype: ring every few minutes, take a photo, keep it with where it was taken. */
export const metadata: Metadata = {
  title: "定期ログ / TRACE",
  robots: { index: false, follow: false },
  // iOS only lets a page notify once it is added to the home screen as an app.
  manifest: withBasePath("/log.webmanifest"),
  appleWebApp: { capable: true, title: "TRACE" },
};

export default function LogPage() {
  return <PingLogClient />;
}
