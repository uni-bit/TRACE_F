export type ClassroomFloor = {
  id: string;
  label: string;
  image: string;
  texture: string;
  title: string;
  rooms: string[];
  stairAnchors?: {
    x: number;
    topZ: number;
    bottomZ: number;
  };
  verticalFeatures?: Array<{
    kind: "elevator" | "escalator" | "stairs";
    x: number;
    z: number;
    direction?: 1 | -1;
    width?: number;
    depth?: number;
  }>;
};

export const classroomFloors: ClassroomFloor[] = [
  {
    id: "1",
    label: "1F",
    image: "/floorplans/classroom/classroom-1.png",
    texture: "/floorplans/classroom/classroom-1-texture.png",
    title: "防災センター・テクノプラザI/IV",
    rooms: ["防災センター", "テクノプラザI", "テクノプラザIV", "WC", "EV・階段"],
    verticalFeatures: [
      { kind: "elevator", x: 0.32, z: -0.23, width: 0.09, depth: 0.08 },
      { kind: "escalator", x: -0.13, z: 0.20, direction: -1, width: 0.08, depth: 0.16 },
      { kind: "stairs", x: -0.30, z: -0.30, direction: 1, width: 0.08, depth: 0.10 },
    ],
  },
  {
    id: "2",
    label: "2F",
    image: "/floorplans/classroom/classroom-2.png",
    texture: "/floorplans/classroom/classroom-2-texture.png",
    title: "大学事務・学生支援",
    rooms: ["大学企画課", "学事課", "学生課", "大学院課", "キャリアサポート課", "教育イノベーション課", "WC", "EV・階段"],
    verticalFeatures: [
      { kind: "elevator", x: 0.32, z: -0.23, width: 0.09, depth: 0.08 },
      { kind: "stairs", x: -0.12, z: -0.08, direction: 1, width: 0.09, depth: 0.14 },
    ],
  },
  {
    id: "3",
    label: "3F",
    image: "/floorplans/classroom/classroom-3.png",
    texture: "/floorplans/classroom/classroom-3-texture.png",
    title: "教室（301〜305）",
    rooms: ["301教室", "302教室", "303教室", "304教室", "305教室", "WC", "EV・階段"],
    stairAnchors: { x: -0.32, topZ: -0.25, bottomZ: 0.34 },
    verticalFeatures: [{ kind: "elevator", x: 0.32, z: -0.23, width: 0.09, depth: 0.08 }],
  },
  {
    id: "4",
    label: "4F",
    image: "/floorplans/classroom/classroom-4.png",
    texture: "/floorplans/classroom/classroom-4-texture.png",
    title: "教室（403〜408）",
    rooms: ["403教室", "404教室", "405教室", "406教室", "407教室", "408教室", "WC", "EV・階段"],
    stairAnchors: { x: -0.32, topZ: -0.25, bottomZ: 0.34 },
    verticalFeatures: [{ kind: "elevator", x: 0.32, z: -0.23, width: 0.09, depth: 0.08 }],
  },
  {
    id: "5",
    label: "5F",
    image: "/floorplans/classroom/classroom-5.png",
    texture: "/floorplans/classroom/classroom-5-texture.png",
    title: "教室・JUCTe（日本国際大学連合）",
    rooms: ["502〜511教室", "JUCTe（日本国際大学連合）", "WC", "EV・階段"],
    stairAnchors: { x: -0.32, topZ: -0.25, bottomZ: 0.34 },
    verticalFeatures: [{ kind: "elevator", x: 0.32, z: -0.23, width: 0.09, depth: 0.08 }],
  },
  {
    id: "6",
    label: "6F",
    image: "/floorplans/classroom/classroom-6.png",
    texture: "/floorplans/classroom/classroom-6-texture.png",
    title: "PC講義室・PC実習室・大学院生室",
    rooms: ["PC講義室 1〜3", "PC実習室 1〜6", "大学院生室", "WC", "EV・階段"],
    stairAnchors: { x: -0.32, topZ: -0.25, bottomZ: 0.34 },
    verticalFeatures: [{ kind: "elevator", x: 0.32, z: -0.23, width: 0.09, depth: 0.08 }],
  },
];

export const classroomFloorByIndex = new Map(classroomFloors.map((floor, index) => [index, floor]));
