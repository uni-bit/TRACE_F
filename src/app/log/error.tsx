"use client";

import { useEffect } from "react";

import "@/components/ping-log/ray/ray.css";

/**
 * What a visitor sees instead of Next's blank page when /log cannot draw: a
 * screen's code gone after a deploy replaced it, or anything else. The
 * photos already saved stay on the phone, and loading the page again brings
 * them back; retry() alone would ask for the same missing code again.
 */
export default function LogError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="ray">
      <div className="phone">
        <main className="screen screen--flex oops">
          {/* Phrases by hand, as Sentences would set them, without loading BudouX for this one screen. */}
          <h1 className="h1 px-phrases">
            画面を<wbr />表示<wbr />できませんでした
          </h1>
          <p className="small px-phrases">
            保存した<wbr />写真は、<wbr />この<wbr />スマホに<wbr />残っています。
            <br />
            もう一度<wbr />読み込むと、<wbr />続きから<wbr />使えます。
          </p>
          <div className="oops__foot">
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              もう一度読み込む
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
