"use client";

import { useEffect, useRef } from "react";

import { FloorMapViewer } from "@/lib/map/floor-map-viewer";
import type { MapTweaks } from "@/lib/map/tweaks";
import type { BuildingDefinition, CameraMode, MapLayer } from "@/lib/map/types";

type FloorMapCanvasProps = {
  buildings: BuildingDefinition[];
  selectedLevel: number | null;
  cameraMode: CameraMode;
  debugStack?: boolean;
  /** ?fx=off bypasses the composer for low-end devices. */
  effects?: boolean;
  layerVisibility?: Record<MapLayer, boolean>;
  /** Where true north lands on screen, in degrees clockwise from the top. */
  onNorthAngle?: (degrees: number) => void;
  tweaks: MapTweaks;
};

export function FloorMapCanvas({ buildings, selectedLevel, cameraMode, debugStack = false, effects = true, layerVisibility, onNorthAngle, tweaks }: FloorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<FloorMapViewer | null>(null);
  // Held in a ref so a caller passing an inline function does not tear the
  // whole GL context down and rebuild it on every render.
  const northAngleRef = useRef(onNorthAngle);
  // Same reason: the viewer is built once, so the first tweaks reach it as a
  // constructor argument and every later change as a set* call.
  const tweaksRef = useRef(tweaks);
  useEffect(() => {
    northAngleRef.current = onNorthAngle;
  }, [onNorthAngle]);

  useEffect(() => {
    tweaksRef.current = tweaks;
    viewerRef.current?.setTweaks(tweaks);
  }, [tweaks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new FloorMapViewer(container, buildings, effects, tweaksRef.current);
    viewer.setViewListener((degrees) => northAngleRef.current?.(degrees));
    viewerRef.current = viewer;
    const devWindow = window as Window & { __traceFloorMapViewer?: FloorMapViewer };
    if (process.env.NODE_ENV !== "production") devWindow.__traceFloorMapViewer = viewer;
    return () => {
      if (devWindow.__traceFloorMapViewer === viewer) delete devWindow.__traceFloorMapViewer;
      viewerRef.current = null;
      viewer.dispose();
    };
  }, [buildings, effects]);

  useEffect(() => {
    viewerRef.current?.setSelectedFloor(selectedLevel);
  }, [selectedLevel]);

  useEffect(() => {
    viewerRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  useEffect(() => {
    viewerRef.current?.setDebugStack(debugStack);
  }, [debugStack]);

  useEffect(() => {
    if (!layerVisibility) return;
    for (const [layer, visible] of Object.entries(layerVisibility)) {
      viewerRef.current?.setLayerVisibility(layer as MapLayer, visible);
    }
  }, [layerVisibility]);

  return <div ref={containerRef} className="campus-3d-view" role="img" aria-label="豊洲キャンパスの3Dフロアモデル" />;
}
