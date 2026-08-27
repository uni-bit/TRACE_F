"use client";

import { useState } from "react";

import { PLAN_NORTH_BEARING_DEG } from "@/lib/map/plan-transform";
import {
  DEFAULT_TWEAKS,
  TONE_KEYS,
  TONE_LABELS,
  type MapTweaks,
  type ToneKey,
  type ToneSet,
} from "@/lib/map/tweaks";

type TweaksPanelProps = {
  tweaks: MapTweaks;
  onChange: (next: MapTweaks) => void;
  onClose: () => void;
};

const TONE_GROUPS: { key: "selected" | "all" | "dimmedStack"; label: string; note: string }[] = [
  { key: "selected", label: "選択中の階", note: "階を1つ選んだとき、その階の濃度" },
  { key: "all", label: "ALL(全階表示)", note: "階を選ばず全階を重ねたときの濃度" },
  { key: "dimmedStack", label: "背景の階(合計)", note: "選択外の階を重ね終えた合計の濃度。1枚あたりではないので階数が増えても濃くならない" },
];

const COLOUR_FIELDS: { key: keyof MapTweaks["colour"]; label: string }[] = [
  { key: "slab", label: "床" },
  { key: "wall", label: "壁" },
  { key: "core", label: "階段・EV" },
  { key: "furniture", label: "什器" },
  { key: "outline", label: "外形線" },
  { key: "plan", label: "図面の色かけ" },
  { key: "background", label: "背景・フォグ" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="tweak-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}</output>
    </label>
  );
}

export function TweaksPanel({ tweaks, onChange, onClose }: TweaksPanelProps) {
  const [copied, setCopied] = useState(false);

  const setTone = (group: "selected" | "all" | "dimmedStack", key: ToneKey, value: number) => {
    const next: ToneSet = { ...tweaks[group], [key]: value };
    onChange({ ...tweaks, [group]: next });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(tweaks, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission is not something to interrupt the reader over.
    }
  };

  return (
    <aside className="map-tweaks" aria-label="表示パラメータ">
      <header className="map-tweaks-head">
        <div>
          <span>TWEAKS</span>
          <strong>表示パラメータ</strong>
        </div>
        <div className="map-tweaks-head-actions">
          <button type="button" onClick={() => onChange(structuredClone(DEFAULT_TWEAKS))}>
            リセット
          </button>
          <button type="button" onClick={copy}>{copied ? "コピーした" : "JSONコピー"}</button>
          <button type="button" onClick={onClose} aria-label="閉じる">✕</button>
        </div>
      </header>

      <div className="map-tweaks-body">
        {TONE_GROUPS.map((group) => (
          <section key={group.key}>
            <h3>{group.label}</h3>
            <p>{group.note}</p>
            {TONE_KEYS.map((key) => (
              <Slider
                key={key}
                label={TONE_LABELS[key]}
                value={tweaks[group.key][key]}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => setTone(group.key, key, value)}
              />
            ))}
          </section>
        ))}

        <section>
          <h3>ステージ</h3>
          <p>選択階の持ち上げ、露出、フォグ。フォグを薄くすると遠い棟まで濃く出る</p>
          <Slider
            label="選択階の持ち上げ"
            value={tweaks.selectedLift}
            min={0}
            max={0.4}
            step={0.005}
            onChange={(value) => onChange({ ...tweaks, selectedLift: value })}
          />
          <Slider
            label="露出"
            value={tweaks.exposure}
            min={0.3}
            max={2.5}
            step={0.05}
            onChange={(value) => onChange({ ...tweaks, exposure: value })}
          />
          <Slider
            label="フォグ濃度"
            value={tweaks.fogDensity}
            min={0}
            max={0.08}
            step={0.001}
            onChange={(value) => onChange({ ...tweaks, fogDensity: value })}
          />
        </section>

        <section>
          <h3>ブルーム</h3>
          <p>光がにじむ量。線を締めたいときは強度を落とすか閾値を上げる</p>
          <label className="tweak-row tweak-check">
            <span>有効</span>
            <input
              type="checkbox"
              checked={tweaks.bloom.enabled}
              onChange={(event) =>
                onChange({ ...tweaks, bloom: { ...tweaks.bloom, enabled: event.target.checked } })
              }
            />
          </label>
          <Slider
            label="強度"
            value={tweaks.bloom.strength}
            min={0}
            max={1.5}
            step={0.01}
            onChange={(value) => onChange({ ...tweaks, bloom: { ...tweaks.bloom, strength: value } })}
          />
          <Slider
            label="半径"
            value={tweaks.bloom.radius}
            min={0}
            max={1.5}
            step={0.01}
            onChange={(value) => onChange({ ...tweaks, bloom: { ...tweaks.bloom, radius: value } })}
          />
          <Slider
            label="閾値"
            value={tweaks.bloom.threshold}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => onChange({ ...tweaks, bloom: { ...tweaks.bloom, threshold: value } })}
          />
        </section>

        <section>
          <h3>色</h3>
          <div className="tweak-colours">
            {COLOUR_FIELDS.map((field) => (
              <label key={field.key}>
                <input
                  type="color"
                  value={tweaks.colour[field.key]}
                  onChange={(event) =>
                    onChange({ ...tweaks, colour: { ...tweaks.colour, [field.key]: event.target.value } })
                  }
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>方位</h3>
          <p>
            0° は図面のまま(図面の上が画面の上)。実測では豊洲キャンパスの建物グリッドは
            真北から {PLAN_NORTH_BEARING_DEG}° 振れている
          </p>
          <Slider
            label="真北補正"
            value={tweaks.northBearingDeg}
            min={0}
            max={90}
            step={1}
            onChange={(value) => onChange({ ...tweaks, northBearingDeg: value })}
          />
        </section>
      </div>
    </aside>
  );
}
