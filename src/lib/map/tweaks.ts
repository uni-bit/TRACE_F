/**
 * Every number that decides how the model *reads*, in one editable object.
 *
 * These used to be module constants tuned once by whoever last looked at the
 * screen, which is the wrong place for them: how legible a fifty-one-sheet
 * stack is depends on the display, the room and what the reader is trying to
 * see, and none of that is knowable from here. The viewer takes the whole
 * object and applies it live; the panel writes it; localStorage remembers it.
 *
 * Geometry is deliberately not in here. Slab thickness, wall thickness and the
 * storey pitch are measured or derived (see plan-transform.ts §3.1), and a
 * slider that quietly makes the building the wrong height would undo the point
 * of measuring them.
 */

export type ToneKey = "plan" | "wall" | "slab" | "outline" | "core" | "furniture";

export type ToneSet = Record<ToneKey, number>;

export interface MapTweaks {
  /** The floor the reader picked. */
  selected: ToneSet;
  /** Every floor, when no single floor is picked. */
  all: ToneSet;
  /**
   * Targets for the *complete stack* of unselected floors, not per floor: the
   * viewer solves the per-sheet alpha that composites to this, so the campus
   * does not get more opaque as it gains floors.
   */
  dimmedStack: ToneSet;
  /** How far the picked floor lifts out of the stack, in world units. */
  selectedLift: number;
  colour: {
    slab: string;
    wall: string;
    core: string;
    furniture: string;
    outline: string;
    /** Multiplies the plan texture, so white leaves the drawing as drawn. */
    plan: string;
    background: string;
  };
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
  fogDensity: number;
  exposure: number;
  /**
   * Degrees the campus is turned so that screen north is true north. 0 leaves
   * the drawing square to the screen, which is how the plans are drawn; 43 is
   * the measured bearing of the real campus grid (plan-transform.ts §3.1).
   */
  northBearingDeg: number;
}

export const DEFAULT_TWEAKS: MapTweaks = {
  selected: { plan: 1, wall: 0.85, slab: 0.72, outline: 0.55, core: 0.62, furniture: 0.15 },
  all: { plan: 0.26, wall: 0.34, slab: 0.24, outline: 0.2, core: 0.3, furniture: 0.08 },
  dimmedStack: { plan: 0.08, wall: 0.07, slab: 0.03, outline: 0.08, core: 0, furniture: 0 },
  selectedLift: 0.09,
  colour: {
    slab: "#6ecfae",
    wall: "#8de4c4",
    core: "#8de4c4",
    furniture: "#9fd8c6",
    outline: "#8de4c4",
    plan: "#ffffff",
    background: "#0b1420",
  },
  bloom: { enabled: true, strength: 0.35, radius: 0.6, threshold: 0.55 },
  fogDensity: 0.018,
  exposure: 1.15,
  // Off by default: the drawing's own orientation is what the floor plans are
  // read against, and turning it is a separate decision from reading it.
  northBearingDeg: 0,
};

export const TONE_KEYS: ToneKey[] = ["slab", "plan", "wall", "outline", "core", "furniture"];

export const TONE_LABELS: Record<ToneKey, string> = {
  slab: "床(スラブ)",
  plan: "図面",
  wall: "壁",
  outline: "外形線",
  core: "階段・EV",
  furniture: "什器",
};

const STORAGE_KEY = "trace.map.tweaks.v1";

function mergeTone(base: ToneSet, patch: unknown): ToneSet {
  if (!patch || typeof patch !== "object") return { ...base };
  const source = patch as Partial<Record<ToneKey, unknown>>;
  const out = { ...base };
  for (const key of TONE_KEYS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * Merged field by field rather than trusted wholesale: a stored object written
 * by an older build is missing whatever has been added since, and spreading it
 * over the defaults would leave those fields undefined rather than defaulted.
 */
export function mergeTweaks(patch: unknown): MapTweaks {
  const base = DEFAULT_TWEAKS;
  if (!patch || typeof patch !== "object") return structuredClone(base);
  const source = patch as Record<string, unknown>;
  const number = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const colour = (source.colour ?? {}) as Record<string, unknown>;
  const bloom = (source.bloom ?? {}) as Record<string, unknown>;
  return {
    selected: mergeTone(base.selected, source.selected),
    all: mergeTone(base.all, source.all),
    dimmedStack: mergeTone(base.dimmedStack, source.dimmedStack),
    selectedLift: number(source.selectedLift, base.selectedLift),
    colour: {
      slab: text(colour.slab, base.colour.slab),
      wall: text(colour.wall, base.colour.wall),
      core: text(colour.core, base.colour.core),
      furniture: text(colour.furniture, base.colour.furniture),
      outline: text(colour.outline, base.colour.outline),
      plan: text(colour.plan, base.colour.plan),
      background: text(colour.background, base.colour.background),
    },
    bloom: {
      enabled: typeof bloom.enabled === "boolean" ? bloom.enabled : base.bloom.enabled,
      strength: number(bloom.strength, base.bloom.strength),
      radius: number(bloom.radius, base.bloom.radius),
      threshold: number(bloom.threshold, base.bloom.threshold),
    },
    fogDensity: number(source.fogDensity, base.fogDensity),
    exposure: number(source.exposure, base.exposure),
    northBearingDeg: number(source.northBearingDeg, base.northBearingDeg),
  };
}

export function loadTweaks(): MapTweaks {
  if (typeof window === "undefined") return structuredClone(DEFAULT_TWEAKS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? mergeTweaks(JSON.parse(raw)) : structuredClone(DEFAULT_TWEAKS);
  } catch {
    // A corrupt or blocked store is not a reason to fail to draw a map.
    return structuredClone(DEFAULT_TWEAKS);
  }
}

export function saveTweaks(tweaks: MapTweaks): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks));
  } catch {
    // Private mode, quota, blocked storage: the session still works.
  }
}
