import { useCallback, useRef } from "react";
import { useAgentStore, useUIStore } from "../stores";

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function useSelection() {
  const { selectAgent, clearSelection, selectedAgentIds } = useAgentStore();
  const {
    isBoxSelecting,
    boxSelectStart,
    boxSelectEnd,
    startBoxSelect,
    updateBoxSelect,
    endBoxSelect,
  } = useUIStore();

  const agentPositionsRef = useRef<Map<string, Bounds>>(new Map());

  const registerAgentPosition = useCallback((agentId: string, bounds: Bounds) => {
    agentPositionsRef.current.set(agentId, bounds);
  }, []);

  const unregisterAgentPosition = useCallback((agentId: string) => {
    agentPositionsRef.current.delete(agentId);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, clearOnEmpty = true) => {
      if (e.button !== 0) return; // Only left click
      if (e.ctrlKey || e.metaKey) return; // Don't start box select with modifier

      // Don't start box select on interactive elements
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (
        tagName === "button" ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        tagName === "a" ||
        target.closest("button") ||
        target.closest("a") ||
        target.closest(".btn")
      ) {
        return;
      }

      const point = { x: e.clientX, y: e.clientY };
      startBoxSelect(point);

      if (clearOnEmpty) {
        clearSelection();
      }
    },
    [startBoxSelect, clearSelection]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isBoxSelecting) return;
      updateBoxSelect({ x: e.clientX, y: e.clientY });
    },
    [isBoxSelecting, updateBoxSelect]
  );

  const handleMouseUp = useCallback(() => {
    if (!isBoxSelecting || !boxSelectStart || !boxSelectEnd) {
      endBoxSelect();
      return;
    }

    // Calculate selection bounds
    const bounds: Bounds = {
      left: Math.min(boxSelectStart.x, boxSelectEnd.x),
      top: Math.min(boxSelectStart.y, boxSelectEnd.y),
      right: Math.max(boxSelectStart.x, boxSelectEnd.x),
      bottom: Math.max(boxSelectStart.y, boxSelectEnd.y),
    };

    // Find agents within bounds
    agentPositionsRef.current.forEach((agentBounds, agentId) => {
      if (boundsIntersect(bounds, agentBounds)) {
        selectAgent(agentId, true);
      }
    });

    endBoxSelect();
  }, [
    isBoxSelecting,
    boxSelectStart,
    boxSelectEnd,
    selectAgent,
    endBoxSelect,
  ]);

  const getSelectionBox = useCallback(() => {
    if (!isBoxSelecting || !boxSelectStart || !boxSelectEnd) {
      return null;
    }

    return {
      left: Math.min(boxSelectStart.x, boxSelectEnd.x),
      top: Math.min(boxSelectStart.y, boxSelectEnd.y),
      width: Math.abs(boxSelectEnd.x - boxSelectStart.x),
      height: Math.abs(boxSelectEnd.y - boxSelectStart.y),
    };
  }, [isBoxSelecting, boxSelectStart, boxSelectEnd]);

  return {
    isBoxSelecting,
    selectedAgentIds,
    registerAgentPosition,
    unregisterAgentPosition,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    getSelectionBox,
  };
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}
