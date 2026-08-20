import { loadFeatures } from "./features";
import { loadContextFeatures } from "./context-features";
import generated from "./toyosu-classroom.generated.json";
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
  generated.buildingId,
  generated.plan,
  generated.floors.map((floor) => ({ id: floor.id, level: floor.level })),
);
const neighbors = loadContextFeatures(
  generated.buildingId,
  generated.plan,
  generated.generated.masterRect,
  generated.generated.contextRect,
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
  floors: buildFloors(),
  features: { ...features.building, neighbors },
};

export function footprintFor(building: BuildingDefinition, floorId: string): [number, number][] {
  return building.features.footprints.byFloor[floorId] ?? building.features.footprints.default;
}

export const buildings: BuildingDefinition[] = [toyosuClassroom];
