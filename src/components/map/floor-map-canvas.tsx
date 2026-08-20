"use client";

import { useEffect, useRef } from "react";

import { FloorMapViewer } from "@/lib/map/floor-map-viewer";
import type { BuildingDefinition, CameraMode, MapLayer } from "@/lib/map/types";

type FloorMapCanvasProps = {
  buildings: BuildingDefinition[];
  selectedLevel: number | null;
  cameraMode: CameraMode;
  debugStack?: boolean;
  /** ?fx=off bypasses the composer for low-end devices. */
  effects?: boolean;
  layerVisibility?: Record<MapLayer, boolean>;
};

export function FloorMapCanvas({ buildings, selectedLevel, cameraMode, debugStack = false, effects = true, layerVisibility }: FloorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<FloorMapViewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new FloorMapViewer(container, buildings, effects);
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
