import type { Metadata } from "next";

import { SurveyClient } from "@/components/survey/survey-client";

/** Staff-only instrument; keep it out of search results and out of the nav. */
export const metadata: Metadata = {
  title: "位置の実測 / TRACE",
  robots: { index: false, follow: false },
};

export default function SurveyPage() {
  return <SurveyClient />;
}
