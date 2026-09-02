import { loadFeatures, type RawBuildingFeatures } from "./features";
import generated from "./toyosu-classroom.generated.json";
import classroomFeatures from "./toyosu-classroom.features.json";
import researchGenerated from "./toyosu-research.generated.json";
import researchFeaturesRaw from "./toyosu-research.features.json";
import exchangeGenerated from "./toyosu-exchange.generated.json";
import exchangeFeaturesRaw from "./toyosu-exchange.features.json";
import headquartersGenerated from "./toyosu-headquarters.generated.json";
import headquartersFeaturesRaw from "./toyosu-headquarters.features.json";
import sharedWestGenerated from "./toyosu-shared-west.generated.json";
import sharedWestFeaturesRaw from "./toyosu-shared-west.features.json";
import sharedEastGenerated from "./toyosu-shared-east.generated.json";
import sharedEastFeaturesRaw from "./toyosu-shared-east.features.json";
import deckGenerated from "./toyosu-deck.generated.json";
import deckFeaturesRaw from "./toyosu-deck.features.json";
import westConnectorGenerated from "./toyosu-west-connector.generated.json";
import westConnectorFeaturesRaw from "./toyosu-west-connector.features.json";
import eastConnectorGenerated from "./toyosu-east-connector.generated.json";
import eastConnectorFeaturesRaw from "./toyosu-east-connector.features.json";
import roofGardenGenerated from "./toyosu-roof-garden.generated.json";
import roofGardenFeaturesRaw from "./toyosu-roof-garden.features.json";
import type { BuildingDefinition, BuildingFloor, FloorMeta, WallSegment } from "./types";

const classroomFloorMeta: FloorMeta[] = [
  {
    id: "1",
    label: "1F",
    title: "防災センター・テクノプラザI/IV",
    rooms: ["防災センター", "テクノプラザI", "テクノプラザIV", "エントランスホール", "WC", "EV・階段"],
  },
  {
    id: "2",
    label: "2F",
    title: "大学事務・学生支援",
    rooms: ["大学企画課", "学事課", "学生課", "大学院課", "キャリアサポート課", "教育イノベーション課", "WC", "EV・階段"],
  },
  {
    id: "3",
    label: "3F",
    title: "教室(301〜305)",
    rooms: ["301教室", "302教室", "303教室", "304教室", "305教室", "大学事務室", "WC", "EV・階段"],
  },
  {
    id: "4",
    label: "4F",
    title: "教室(403〜408)",
    rooms: ["403教室", "404教室", "405教室", "406教室", "407教室", "408教室", "講師室", "WC", "EV・階段"],
  },
  {
    id: "5",
    label: "5F",
    title: "教室・JUCTe(日本国際大学連合)",
    rooms: ["502〜513教室", "JUCTe(日本国際大学連合)", "大会議室", "WC", "EV・階段"],
  },
  {
    id: "6",
    label: "6F",
    title: "教室・研究室(601〜603ほか)",
    rooms: ["601教室", "602教室", "603教室", "共通研究スペース", "大学院生室", "情報イノベーション課", "WC", "EV・階段"],
  },
];

const features = loadFeatures(
  classroomFeatures,
  generated.buildingId,
  generated.plan,
  generated.floors.map((floor) => ({ id: floor.id, level: floor.level })),
);
function buildFloors(): BuildingFloor[] {
  return generated.floors.map((floor) => {
    const meta = classroomFloorMeta.find((m) => m.id === floor.id);
    if (!meta) {
      throw new Error(`floor meta missing for generated floor "${floor.id}" — update classroomFloorMeta`);
    }
    return {
      ...meta,
      level: floor.level,
      texture: floor.texture,
      walls: floor.walls.map(([x1, z1, x2, z2]): WallSegment => [x1, z1, x2, z2]),
      features: features.byFloor[floor.id],
    };
  });
}

export const toyosuClassroom: BuildingDefinition = {
  id: generated.buildingId,
  name: "教室棟",
  englishName: "CLASSROOM BUILDING",
  levelsLabel: "1–6F",
  plan: generated.plan,
  masterRect: generated.generated.masterRect,
  floors: buildFloors(),
  features: features.building,
};

const researchFloorMeta: FloorMeta[] = Array.from({ length: 14 }, (_, index) => {
  const level = index + 1;
  return {
    id: String(level),
    label: `${level}F`,
    title: `研究棟 ${level}階`,
    rooms: ["研究室・実験室", "会議・共用スペース", "WC", "EV・階段"],
  };
});

const researchFeatures = loadFeatures(
  researchFeaturesRaw,
  researchGenerated.buildingId,
  researchGenerated.plan,
  researchGenerated.floors.map((floor) => ({ id: floor.id, level: floor.level })),
  "toyosu-research.features.json",
);

function buildResearchFloors(): BuildingFloor[] {
  return researchGenerated.floors.map((floor) => {
    const meta = researchFloorMeta.find((item) => item.id === floor.id);
    if (!meta) throw new Error(`research floor meta missing for "${floor.id}"`);
    return {
      ...meta,
      level: floor.level,
      texture: floor.texture,
      walls: floor.walls.map(([x1, z1, x2, z2]): WallSegment => [x1, z1, x2, z2]),
      features: researchFeatures.byFloor[floor.id],
    };
  });
}

export const toyosuResearch: BuildingDefinition = {
  id: researchGenerated.buildingId,
  name: "研究棟",
  englishName: "RESEARCH BUILDING",
  levelsLabel: "1–14F",
  plan: researchGenerated.plan,
  masterRect: researchGenerated.generated.masterRect,
  floors: buildResearchFloors(),
  features: researchFeatures.building,
};

const exchangeFloorMeta: FloorMeta[] = Array.from({ length: 6 }, (_, index) => {
  const level = index + 1;
  return {
    id: String(level),
    label: `${level}F`,
    title: `交流棟 ${level}階`,
    rooms: level === 3
      ? ["カフェテリア", "WC", "EV・階段"]
      : ["交流・講義スペース", "WC", "EV・階段"],
  };
});

const exchangeFeatures = loadFeatures(
  exchangeFeaturesRaw,
  exchangeGenerated.buildingId,
  exchangeGenerated.plan,
  exchangeGenerated.floors.map((floor) => ({ id: floor.id, level: floor.level })),
  "toyosu-exchange.features.json",
);

function buildExchangeFloors(): BuildingFloor[] {
  return exchangeGenerated.floors.map((floor) => {
    const meta = exchangeFloorMeta.find((item) => item.id === floor.id);
    if (!meta) throw new Error(`exchange floor meta missing for "${floor.id}"`);
    return {
      ...meta,
      level: floor.level,
      texture: floor.texture,
      walls: floor.walls.map(([x1, z1, x2, z2]): WallSegment => [x1, z1, x2, z2]),
      features: exchangeFeatures.byFloor[floor.id],
    };
  });
}

export const toyosuExchange: BuildingDefinition = {
  id: exchangeGenerated.buildingId,
  name: "交流棟（カフェテリア）",
  englishName: "EXCHANGE BUILDING",
  levelsLabel: "1–6F",
  plan: exchangeGenerated.plan,
  masterRect: exchangeGenerated.generated.masterRect,
  floors: buildExchangeFloors(),
  features: exchangeFeatures.building,
};

const headquartersFloorMeta: FloorMeta[] = [
  {
    // The only floor on the campus below grade, and the only one whose plan is
    // not on a 1F-and-up page of the diary (page 58).
    id: "0",
    label: "B1F",
    title: "体育館・アスレチックジム",
    rooms: ["体育館", "アスレチックジム", "用具庫", "更衣室", "教員控室", "WC", "EV"],
  },
  ...Array.from({ length: 14 }, (_, index) => {
    const level = index + 1;
    return {
      id: String(level),
      label: `${level}F`,
      title: `本部棟 ${level}階`,
      rooms: level >= 12
        ? ["本部・管理部門", "会議・共用スペース", "WC", "EV・階段"]
        : ["教室・事務・研究スペース", "シアター・会議室", "WC", "EV・階段"],
    };
  }),
];

const headquartersFeatures = loadFeatures(
  headquartersFeaturesRaw,
  headquartersGenerated.buildingId,
  headquartersGenerated.plan,
  headquartersGenerated.floors.map((floor) => ({ id: floor.id, level: floor.level })),
  "toyosu-headquarters.features.json",
);

function buildHeadquartersFloors(): BuildingFloor[] {
  return headquartersGenerated.floors.map((floor) => {
    const meta = headquartersFloorMeta.find((item) => item.id === floor.id);
    if (!meta) throw new Error(`headquarters floor meta missing for "${floor.id}"`);
    return {
      ...meta,
      level: floor.level,
      texture: floor.texture,
      walls: floor.walls.map(([x1, z1, x2, z2]): WallSegment => [x1, z1, x2, z2]),
      features: headquartersFeatures.byFloor[floor.id],
    };
  });
}

export const toyosuHeadquarters: BuildingDefinition = {
  id: headquartersGenerated.buildingId,
  name: "本部棟",
  englishName: "HEADQUARTERS BUILDING",
  levelsLabel: "B1–14F",
  plan: headquartersGenerated.plan,
  masterRect: headquartersGenerated.generated.masterRect,
  floors: buildHeadquartersFloors(),
  features: headquartersFeatures.building,
};

interface StructureGeometry {
  buildingId: string;
  plan: { widthPx: number; heightPx: number };
  generated: { masterRect: { x: number; y: number; w: number; h: number } };
  floors: { id: string; level: number; texture: string; walls: number[][] }[];
}

function buildStructure(
  generatedStructure: StructureGeometry,
  rawFeatures: RawBuildingFeatures,
  meta: { name: string; englishName: string; title: string; rooms: string[] },
): BuildingDefinition {
  const structureFeatures = loadFeatures(
    rawFeatures,
    generatedStructure.buildingId,
    generatedStructure.plan,
    generatedStructure.floors.map((floor) => ({ id: floor.id, level: floor.level })),
  );
  return {
    id: generatedStructure.buildingId,
    name: meta.name,
    englishName: meta.englishName,
    levelsLabel: generatedStructure.floors.map((floor) => `${floor.level}F`).join("・"),
    plan: generatedStructure.plan,
    masterRect: generatedStructure.generated.masterRect,
    floors: generatedStructure.floors.map((floor) => ({
      id: floor.id,
      label: `${floor.level}F`,
      title: meta.title,
      rooms: meta.rooms,
      level: floor.level,
      texture: floor.texture,
      walls: floor.walls.map(([x1, z1, x2, z2]): WallSegment => [x1, z1, x2, z2]),
      features: structureFeatures.byFloor[floor.id],
    })),
    features: structureFeatures.building,
  };
}

export const toyosuSharedWest = buildStructure(sharedWestGenerated, sharedWestFeaturesRaw, {
  name: "1F共用部（楽器・倉庫）",
  englishName: "SHARED USE WEST",
  title: "楽器・倉庫共用部",
  rooms: ["楽器倉庫", "音楽室", "倉庫", "危険物置場"],
});

export const toyosuSharedEast = buildStructure(sharedEastGenerated, sharedEastFeaturesRaw, {
  name: "1F共用部（交流プラザ）",
  englishName: "SHARED USE EAST",
  title: "交流プラザ共用部",
  rooms: ["交流プラザ", "校友会事務局", "校友ラウンジ", "有元史郎メモリアルコーナー"],
});

export const toyosuDeck = buildStructure(deckGenerated, deckFeaturesRaw, {
  name: "棟間デッキ",
  englishName: "INTER-BUILDING DECK",
  title: "シバウラキッズパーク・フラワーガーデン",
  rooms: ["シバウラキッズパーク", "フラワーガーデン"],
});

export const toyosuWestConnector = buildStructure(westConnectorGenerated, westConnectorFeaturesRaw, {
  name: "西側連絡通路",
  englishName: "WEST CONNECTOR",
  title: "棟間連絡通路",
  rooms: ["連絡通路"],
});

export const toyosuEastConnector = buildStructure(eastConnectorGenerated, eastConnectorFeaturesRaw, {
  name: "東側連絡通路",
  englishName: "EAST CONNECTOR",
  title: "棟間連絡通路",
  rooms: ["連絡通路"],
});

export const toyosuRoofGarden = buildStructure(roofGardenGenerated, roofGardenFeaturesRaw, {
  name: "教室棟屋上庭園",
  englishName: "CLASSROOM ROOF GARDEN",
  title: "屋上庭園",
  rooms: ["屋上庭園"],
});

export function footprintFor(building: BuildingDefinition, floorId: string): [number, number][] {
  return building.features.footprints.byFloor[floorId] ?? building.features.footprints.default;
}

/** One entry per region of the drawings; see scripts/floorplan/config.json. */
export const buildings: BuildingDefinition[] = [
  toyosuClassroom,
  toyosuResearch,
  toyosuExchange,
  toyosuHeadquarters,
  toyosuSharedWest,
  toyosuSharedEast,
  toyosuDeck,
  toyosuWestConnector,
  toyosuEastConnector,
  toyosuRoofGarden,
];

export interface CampusLevel {
  level: number;
  label: string;
  /** Structures that have a floor at this level, largest plate first. */
  buildingIds: string[];
}

/** B1 is the only level below grade, and the only one whose label is not `${n}F`. */
export function levelLabel(level: number): string {
  return level <= 0 ? `B${1 - level}F` : `${level}F`;
}

/**
 * Every level the campus has a drawing for, in order. The classroom building
 * stops at 6F while the research and headquarters towers run to 14F, so a
 * campus-wide floor picker cannot be built from any one building's floors.
 */
export const campusLevels: CampusLevel[] = (() => {
  const byLevel = new Map<number, string[]>();
  for (const building of buildings) {
    for (const floor of building.floors) {
      const entry = byLevel.get(floor.level) ?? [];
      entry.push(building.id);
      byLevel.set(floor.level, entry);
    }
  }
  const area = new Map(buildings.map((building) => [building.id, building.masterRect.w * building.masterRect.h]));
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, buildingIds]) => ({
      level,
      label: levelLabel(level),
      buildingIds: buildingIds.sort((a, b) => (area.get(b) ?? 0) - (area.get(a) ?? 0)),
    }));
})();

export function buildingById(id: string): BuildingDefinition | undefined {
  return buildings.find((building) => building.id === id);
}
