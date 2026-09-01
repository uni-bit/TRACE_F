"use client";

import dynamic from "next/dynamic";

/**
 * The survey screen is an instrument for one device: it reads `localStorage`
 * and `window` at mount and everything on it comes from sensors.
 * Server-rendering it would only produce markup that is wrong by definition
 * and then have to be reconciled, so it is loaded client-side only.
 */
const SurveyScreen = dynamic(() => import("./survey-screen").then((module) => module.SurveyScreen), {
  ssr: false,
  loading: () => <main className="survey"><p className="survey-empty">計測ツールを読み込んでいます…</p></main>,
});

export function SurveyClient() {
  return <SurveyScreen />;
}
