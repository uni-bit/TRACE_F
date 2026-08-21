import { loadFeatures } from "./features";
import generated from "./toyosu-classroom.generated.json";
import classroomFeatures from "./toyosu-classroom.features.json";
import researchGenerated from "./toyosu-research.generated.json";
import researchFeaturesRaw from "./toyosu-research.features.json";
import exchangeGenerated from "./toyosu-exchange.generated.json";
import exchangeFeaturesRaw from "./toyosu-exchange.features.json";
import headquartersGenerated from "./toyosu-headquarters.generated.json";
import headquartersFeaturesRaw from "./toyosu-headquarters.features.json";
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

const headquartersFloorMeta: FloorMeta[] = Array.from({ length: 14 }, (_, index) => {
  const level = index + 1;
  return {
    id: String(level),
    label: `${level}F`,
    title: `本部棟 ${level}階`,
    rooms: level >= 12
      ? ["本部・管理部門", "会議・共用スペース", "WC", "EV・階段"]
      : ["教室・事務・研究スペース", "シアター・会議室", "WC", "EV・階段"],
  };
});

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
  levelsLabel: "1–14F",
  plan: headquartersGenerated.plan,
  masterRect: headquartersGenerated.generated.masterRect,
  floors: buildHeadquartersFloors(),
  features: headquartersFeatures.building,
};

export function footprintFor(building: BuildingDefinition, floorId: string): [number, number][] {
  return building.features.footprints.byFloor[floorId] ?? building.features.footprints.default;
}

export const buildings: BuildingDefinition[] = [
  toyosuClassroom,
  toyosuResearch,
  toyosuExchange,
  toyosuHeadquarters,
];
