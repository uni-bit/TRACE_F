"use client";

import { useEffect, useRef } from "react";

import { FloorMapViewer } from "@/lib/map/floor-map-viewer";
import type { BuildingDefinition, CameraMode } from "@/lib/map/types";

type FloorMapCanvasProps = {
  building: BuildingDefinition;
  selectedFloorId: string | null;
  cameraMode: CameraMode;
  debugStack?: boolean;
};

export function FloorMapCanvas({ building, selectedFloorId, cameraMode, debugStack = false }: FloorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<FloorMapViewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new FloorMapViewer(container, building);
    viewerRef.current = viewer;
    const devWindow = window as Window & { __traceFloorMapViewer?: FloorMapViewer };
    if (process.env.NODE_ENV !== "production") devWindow.__traceFloorMapViewer = viewer;
    return () => {
      if (devWindow.__traceFloorMapViewer === viewer) delete devWindow.__traceFloorMapViewer;
      viewerRef.current = null;
      viewer.dispose();
    };
  }, [building]);

  useEffect(() => {
    viewerRef.current?.setSelectedFloor(selectedFloorId);
  }, [selectedFloorId]);

  useEffect(() => {
    viewerRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  useEffect(() => {
    viewerRef.current?.setDebugStack(debugStack);
  }, [debugStack]);

  return <div ref={containerRef} className="campus-3d-view" role="img" aria-label={`${building.name}の3Dフロアモデル`} />;
}
