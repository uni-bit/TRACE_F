"use client";

import { useEffect, useRef } from "react";
import type { ClassroomFloor } from "../lib/toyosu-classroom-building";

export type CampusBuilding3D = {
  id: string;
  name: string;
  englishName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  floors: string;
  levelCount: number;
  heightM: string;
  shape: "standard";
  tone: "violet" | "mint" | "coral" | "sand";
};

type CameraMode = "orbit" | "north";

type Vec3 = [number, number, number];

const toneColors: Record<CampusBuilding3D["tone"], [number, number, number]> = {
  violet: [0.58, 0.48, 1],
  mint: [0.42, 0.88, 0.72],
  coral: [1, 0.56, 0.42],
  sand: [0.84, 0.68, 0.42],
};

const boxVertices = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
  0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5,
]);

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function multiply(a: number[], b: number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
    }
  }
  return result;
}

function perspective(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fov / 2);
  const result = new Array<number>(16).fill(0);
  result[0] = f / aspect;
  result[5] = f;
  result[10] = (far + near) / (near - far);
  result[11] = -1;
  result[14] = (2 * far * near) / (near - far);
  return result;
}

function lookAt(eye: Vec3, center: Vec3, up: Vec3): number[] {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ];
}

function modelMatrix(x: number, y: number, z: number, width: number, height: number, depth: number): number[] {
  return [width, 0, 0, 0, 0, height, 0, 0, 0, 0, depth, 0, x, y, z, 1];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
  return shader;
}

function worldBuilding(building: CampusBuilding3D) {
  const floors = building.levelCount;
  return {
    x: (building.x + building.width / 2 - 50) * 0.16,
    z: (building.y + building.height / 2 - 50) * 0.12,
    width: Math.max(0.9, building.width * 0.085),
    depth: Math.max(0.7, building.height * 0.065),
    floors,
    levelHeight: 0.34,
  };
}

export function Campus3DView({ building, classroomFloors, selectedFloorId, cameraMode }: {
  building: CampusBuilding3D;
  classroomFloors: ClassroomFloor[];
  selectedFloorId: string | null;
  cameraMode: CameraMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef({ yaw: 0.78, pitch: 0.68, distance: 13, targetX: 0, targetY: 0.6, targetZ: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const buildings = [building];
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
    if (!gl) return;

    const vertexShader = compile(gl, gl.VERTEX_SHADER, "attribute vec3 a_position; uniform mat4 u_matrix; void main(){ gl_Position = u_matrix * vec4(a_position, 1.0); }");
    const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, "precision mediump float; uniform vec4 u_color; void main(){ gl_FragColor = u_color; }");
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const matrixLocation = gl.getUniformLocation(program, "u_matrix");
    const colorLocation = gl.getUniformLocation(program, "u_color");
    const boxBuffer = gl.createBuffer();
    if (!boxBuffer || !matrixLocation || !colorLocation) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, boxVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const textureVertexShader = compile(gl, gl.VERTEX_SHADER, "attribute vec3 a_position; attribute vec2 a_uv; uniform mat4 u_matrix; varying vec2 v_uv; void main(){ gl_Position = u_matrix * vec4(a_position, 1.0); v_uv = a_uv; }");
    const textureFragmentShader = compile(gl, gl.FRAGMENT_SHADER, "precision mediump float; uniform sampler2D u_texture; uniform float u_opacity; varying vec2 v_uv; void main(){ vec4 color = texture2D(u_texture, v_uv); gl_FragColor = vec4(color.rgb, color.a * u_opacity); }");
    const textureProgram = gl.createProgram();
    if (!textureProgram) return;
    gl.attachShader(textureProgram, textureVertexShader);
    gl.attachShader(textureProgram, textureFragmentShader);
    gl.linkProgram(textureProgram);
    if (!gl.getProgramParameter(textureProgram, gl.LINK_STATUS)) return;
    const texturePositionLocation = gl.getAttribLocation(textureProgram, "a_position");
    const textureUvLocation = gl.getAttribLocation(textureProgram, "a_uv");
    const textureMatrixLocation = gl.getUniformLocation(textureProgram, "u_matrix");
    const textureOpacityLocation = gl.getUniformLocation(textureProgram, "u_opacity");
    const textureSamplerLocation = gl.getUniformLocation(textureProgram, "u_texture");
    const planePositionBuffer = gl.createBuffer();
    const planeUvBuffer = gl.createBuffer();
    if (!textureMatrixLocation || !textureOpacityLocation || !textureSamplerLocation || !planePositionBuffer || !planeUvBuffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, planePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, planeUvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]), gl.STATIC_DRAW);
    const floorTextures = classroomFloors.map((floor) => {
      const texture = gl.createTexture();
      const image = new Image();
      const item = { floor, texture, ready: false };
      image.onload = () => {
        if (!texture) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        item.ready = true;
      };
      image.src = floor.texture;
      return item;
    });
    let floorLines: Record<string, number[][]> = {};
    void fetch("/floorplans/classroom/lines.json").then((response) => response.json()).then((data: Record<string, number[][]>) => { floorLines = data; }).catch(() => undefined);

    const drawBox = (viewProjection: number[], matrix: number[], color: [number, number, number, number], transparent = false) => {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(matrixLocation, false, new Float32Array(multiply(viewProjection, matrix)));
      gl.uniform4fv(colorLocation, color);
      gl.depthMask(!transparent);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    };

    const drawFloorPlan = (viewProjection: number[], x: number, y: number, z: number, width: number, depth: number, texture: WebGLTexture, opacity: number) => {
      gl.useProgram(textureProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, planePositionBuffer);
      gl.enableVertexAttribArray(texturePositionLocation);
      gl.vertexAttribPointer(texturePositionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, planeUvBuffer);
      gl.enableVertexAttribArray(textureUvLocation);
      gl.vertexAttribPointer(textureUvLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(textureMatrixLocation, false, new Float32Array(multiply(viewProjection, modelMatrix(x, y, z, width, 0.001, depth))));
      gl.uniform1f(textureOpacityLocation, opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(textureSamplerLocation, 0);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    };

    const drawStairFlight = (viewProjection: number[], x: number, y: number, z: number, width: number, depth: number, direction: 1 | -1, opacity: number) => {
      const stairColor: [number, number, number, number] = [0.56, 0.66, 0.68, opacity];
      const steps = 7;
      const stepDepth = Math.max(0.035, depth / steps);
      for (let step = 0; step < steps; step += 1) {
        const stepZ = z + direction * (step - (steps - 1) / 2) * stepDepth;
        drawBox(viewProjection, modelMatrix(x, y + 0.04 + step * 0.022, stepZ, width, 0.035 + step * 0.02, stepDepth * 0.92), stairColor);
      }
    };

    const drawElevator = (viewProjection: number[], x: number, y: number, z: number, planWidth: number, planDepth: number, width: number, depth: number, opacity: number) => {
      const shaftColor: [number, number, number, number] = [0.42, 0.50, 0.54, opacity * 0.72];
      const doorColor: [number, number, number, number] = [0.20, 0.27, 0.31, Math.min(0.95, opacity)];
      const shaftWidth = planWidth * width;
      const shaftDepth = planDepth * depth;
      drawBox(viewProjection, modelMatrix(x, y + 0.15, z, shaftWidth, 0.30, shaftDepth), shaftColor, true);
      drawBox(viewProjection, modelMatrix(x, y + 0.14, z + shaftDepth * 0.51, shaftWidth * 0.72, 0.22, 0.012), doorColor, true);
      drawBox(viewProjection, modelMatrix(x, y + 0.29, z + shaftDepth * 0.51, shaftWidth * 0.88, 0.018, 0.018), shaftColor, true);
    };

    const drawEscalator = (viewProjection: number[], x: number, y: number, z: number, planWidth: number, planDepth: number, width: number, depth: number, direction: 1 | -1, opacity: number) => {
      const railColor: [number, number, number, number] = [0.48, 0.60, 0.62, opacity * 0.8];
      const stepColor: [number, number, number, number] = [0.35, 0.44, 0.47, opacity];
      const runDepth = planDepth * depth;
      const runWidth = planWidth * width;
      const steps = 8;
      const stepDepth = runDepth / steps;
      for (let step = 0; step < steps; step += 1) {
        const stepZ = z + direction * (step - (steps - 1) / 2) * stepDepth;
        drawBox(viewProjection, modelMatrix(x, y + 0.05 + step * 0.025, stepZ, runWidth, 0.025 + step * 0.018, stepDepth * 0.86), stepColor, true);
      }
      const railHeight = 0.14;
      drawBox(viewProjection, modelMatrix(x - runWidth * 0.58, y + 0.12, z, 0.018, railHeight, runDepth), railColor, true);
      drawBox(viewProjection, modelMatrix(x + runWidth * 0.58, y + 0.12, z, 0.018, railHeight, runDepth), railColor, true);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    };

    let animationFrame = 0;
    const pressedKeys = new Set<string>();
    let lastFrameTime = performance.now();
    const render = (frameTime: number) => {
      resize();
      const camera = cameraRef.current;
      const deltaTime = Math.min(0.05, Math.max(0, (frameTime - lastFrameTime) / 1000));
      lastFrameTime = frameTime;
      let moveX = 0;
      let moveZ = 0;
      const forwardX = -Math.sin(camera.yaw);
      const forwardZ = -Math.cos(camera.yaw);
      const rightX = Math.cos(camera.yaw);
      const rightZ = -Math.sin(camera.yaw);
      if (pressedKeys.has("w")) { moveX += forwardX; moveZ += forwardZ; }
      if (pressedKeys.has("s")) { moveX -= forwardX; moveZ -= forwardZ; }
      if (pressedKeys.has("d")) { moveX += rightX; moveZ += rightZ; }
      if (pressedKeys.has("a")) { moveX -= rightX; moveZ -= rightZ; }
      const moveLength = Math.hypot(moveX, moveZ);
      if (moveLength > 0) {
        const moveSpeed = pressedKeys.has("shift") ? 5.4 : 2.7;
        camera.targetX += (moveX / moveLength) * moveSpeed * deltaTime;
        camera.targetZ += (moveZ / moveLength) * moveSpeed * deltaTime;
      }
      const aspect = canvas.width / Math.max(1, canvas.height);
      const eye: Vec3 = [
        camera.targetX + camera.distance * Math.sin(camera.yaw) * Math.cos(camera.pitch),
        camera.targetY + camera.distance * Math.sin(camera.pitch),
        camera.targetZ + camera.distance * Math.cos(camera.yaw) * Math.cos(camera.pitch),
      ];
      const viewProjection = multiply(perspective(Math.PI / 4, aspect, 0.1, 100), lookAt(eye, [camera.targetX, camera.targetY, camera.targetZ], [0, 1, 0]));
      gl.clearColor(0.055, 0.055, 0.09, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      drawBox(viewProjection, modelMatrix(0, -0.16, 0, 13, 0.18, 9), [0.12, 0.14, 0.23, 1]);
      for (let grid = -6; grid <= 6; grid += 1) {
        drawBox(viewProjection, modelMatrix(grid, -0.05, 0, 0.012, 0.012, 9), [0.38, 0.34, 0.65, 0.07], true);
        drawBox(viewProjection, modelMatrix(0, -0.05, grid * 0.68, 13, 0.012, 0.012), [0.38, 0.34, 0.65, 0.07], true);
      }

      buildings.forEach((building) => {
        const item = worldBuilding(building);
        const [r, g, b] = toneColors[building.tone];
        const baseHeight = item.floors * item.levelHeight;
        for (let floor = 0; floor < item.floors; floor += 1) {
          const floorY = floor * item.levelHeight + item.levelHeight * 0.02;
          const floorWidth = item.width;
          const floorDepth = item.depth;
          const isSelectedFloor = selectedFloorId === null || selectedFloorId === String(floor + 1);
          drawBox(viewProjection, modelMatrix(item.x, floorY, item.z, floorWidth * 0.94, 0.035, floorDepth * 0.94), [r, g, b, isSelectedFloor ? 0.34 : 0.035], true);
        }
        if (building.id === "classroom") {
          floorTextures.forEach((entry, floorIndex) => {
            if (!entry.texture || !entry.ready) return;
            const floorY = floorIndex * item.levelHeight + item.levelHeight * 0.04 + (selectedFloorId === entry.floor.id ? 0.09 : 0);
            const planWidth = item.width;
            const planDepth = item.depth;
            const isSelected = selectedFloorId === entry.floor.id;
            // All source PDFs were rendered at the same scale. Per-floor differences are
            // represented by the crop origin, so do not apply an additional scale/offset here.
            const planCenterX = item.x;
            drawFloorPlan(viewProjection, planCenterX, floorY, item.z, planWidth * 0.98, planDepth * 0.98, entry.texture, isSelected ? 0.98 : selectedFloorId ? 0.025 : 0.22);
            if (entry.floor.stairAnchors) {
              const anchor = entry.floor.stairAnchors;
              const anchorOpacity = isSelected ? 0.82 : selectedFloorId ? 0.08 : 0.34;
              drawStairFlight(viewProjection, planCenterX + anchor.x * planWidth, floorY, item.z + anchor.topZ * planDepth, planWidth * 0.085, planDepth * 0.075, 1, anchorOpacity);
              drawStairFlight(viewProjection, planCenterX + anchor.x * planWidth, floorY, item.z + anchor.bottomZ * planDepth, planWidth * 0.085, planDepth * 0.075, -1, anchorOpacity);
            }
            (entry.floor.verticalFeatures ?? []).forEach((feature) => {
              const featureOpacity = isSelected ? 0.82 : selectedFloorId ? 0.08 : 0.34;
              const featureX = planCenterX + feature.x * planWidth;
              const featureZ = item.z + feature.z * planDepth;
              if (feature.kind === "elevator") {
                drawElevator(viewProjection, featureX, floorY, featureZ, planWidth, planDepth, feature.width ?? 0.09, feature.depth ?? 0.08, featureOpacity);
              } else if (feature.kind === "escalator") {
                drawEscalator(viewProjection, featureX, floorY, featureZ, planWidth, planDepth, feature.width ?? 0.08, feature.depth ?? 0.16, feature.direction ?? 1, featureOpacity);
              } else {
                drawStairFlight(viewProjection, featureX, floorY, featureZ, planWidth * (feature.width ?? 0.09), planDepth * (feature.depth ?? 0.14), feature.direction ?? 1, featureOpacity);
              }
            });
            (floorLines[entry.floor.id] ?? []).forEach(([x1, z1, x2, z2]) => {
              const startX = planCenterX + ((x1 + x2) / 2) * planWidth;
              const startZ = item.z + ((z1 + z2) / 2) * planDepth;
              const horizontal = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
              const wallWidth = horizontal ? Math.max(0.025, Math.abs(x2 - x1) * planWidth) : 0.025;
              const wallDepth = horizontal ? 0.025 : Math.max(0.025, Math.abs(z2 - z1) * planDepth);
              const wallOpacity = isSelected ? 0.72 : selectedFloorId ? 0.018 : 0.12;
              drawBox(viewProjection, modelMatrix(startX, floorY + 0.16, startZ, wallWidth, 0.3, wallDepth), [r, g, b, wallOpacity], true);
            });
          });
        }
        drawBox(viewProjection, modelMatrix(item.x, baseHeight / 2, item.z, item.width, baseHeight, item.depth), [r, g, b, selectedFloorId ? 0.025 : 0.08], true);
        drawBox(viewProjection, modelMatrix(item.x - item.width * 0.44, baseHeight / 2, item.z, 0.035, baseHeight, item.depth), [r, g, b, selectedFloorId ? 0.12 : 0.24], true);
        drawBox(viewProjection, modelMatrix(item.x + item.width * 0.44, baseHeight / 2, item.z, 0.035, baseHeight, item.depth), [r, g, b, selectedFloorId ? 0.12 : 0.24], true);
      });

      animationFrame = requestAnimationFrame(render);
    };

    const pointer = { active: false, mode: "orbit" as "orbit" | "pan", x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => {
      pointer.active = true;
      pointer.mode = event.button === 2 ? "pan" : "orbit";
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.active) return;
      const camera = cameraRef.current;
      const deltaX = event.clientX - pointer.x;
      const deltaY = event.clientY - pointer.y;
      if (pointer.mode === "pan") {
        const panScale = camera.distance * 0.0018;
        camera.targetX -= deltaX * panScale * Math.cos(camera.yaw);
        camera.targetZ += deltaX * panScale * Math.sin(camera.yaw);
        camera.targetY += deltaY * panScale;
      } else {
        camera.yaw -= deltaX * 0.008;
        camera.pitch = Math.max(0.18, Math.min(1.35, camera.pitch + deltaY * 0.008));
      }
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onPointerUp = () => { pointer.active = false; };
    const onContextMenu = (event: MouseEvent) => { event.preventDefault(); };
    const onWheel = (event: WheelEvent) => { event.preventDefault(); cameraRef.current.distance = Math.max(7, Math.min(22, cameraRef.current.distance + event.deltaY * 0.012)); };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "shift"].includes(key)) return;
      pressedKeys.add(key);
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => { pressedKeys.delete(event.key.toLowerCase()); };
    const onWindowBlur = () => { pressedKeys.clear(); };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    if (cameraMode === "north") { cameraRef.current.yaw = 0; cameraRef.current.pitch = 0.55; }
    render(performance.now());
    return () => {
      cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      gl.deleteBuffer(boxBuffer);
      gl.deleteBuffer(planePositionBuffer);
      gl.deleteBuffer(planeUvBuffer);
      floorTextures.forEach(({ texture }) => { if (texture) gl.deleteTexture(texture); });
      gl.deleteProgram(program);
      gl.deleteProgram(textureProgram);
    };
  }, [building, cameraMode, classroomFloors, selectedFloorId]);

  return (
    <div className="campus-3d-view" role="application" aria-label="芝浦工業大学豊洲キャンパス教室棟のWebGL 3Dモデル。ドラッグで回転、ホイールで拡大縮小できます。">
      <canvas ref={canvasRef} className="campus-3d-canvas" tabIndex={0} />
      <div className="campus-3d-hint">WASD MOVE · SHIFT FAST · LEFT DRAG ORBIT · RIGHT DRAG PAN · WHEEL ZOOM</div>
      {selectedFloorId && <span className="campus-3d-floor-readout">CLASSROOM / {classroomFloors.find((floor) => floor.id === selectedFloorId)?.label ?? selectedFloorId}</span>}
      <span className="campus-3d-label" style={{ left: "50%", top: "53%" }}>教室棟<small>CLASSROOM BUILDING · 1–6F</small></span>
    </div>
  );
}
