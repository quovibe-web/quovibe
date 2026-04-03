import { useState, useCallback } from 'react';
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';

export interface UseColumnDndOptions {
  visibleColumnIds: string[];
  lockedIds: Set<string>;
  currentOrder: string[];
  allColumnIds: string[];
  onColumnOrderChange: ((order: string[]) => void) | undefined;
}

export function useColumnDnd({
  visibleColumnIds,
  lockedIds,
  currentOrder,
  allColumnIds,
  onColumnOrderChange,
}: UseColumnDndOptions) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // native-ok
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !onColumnOrderChange) return;

    const base = currentOrder.length > 0 ? currentOrder : allColumnIds;

    // Pinned = locked + hidden columns (not in visible set)
    const visibleSet = new Set(visibleColumnIds);
    const pinnedSet = new Set<string>();
    for (const id of lockedIds) pinnedSet.add(id);
    for (const id of base) {
      if (!visibleSet.has(id)) pinnedSet.add(id);
    }

    const movableOrder = base.filter(id => !pinnedSet.has(id));
    const oldIndex = movableOrder.indexOf(String(active.id)); // native-ok
    const newIndex = movableOrder.indexOf(String(over.id)); // native-ok
    if (oldIndex === -1 || newIndex === -1) return;

    const newMovable = arrayMove(movableOrder, oldIndex, newIndex);

    // Re-insert pinned columns at their original positions
    const result = [...newMovable];
    const pinnedPositions = base
      .map((id, i) => pinnedSet.has(id) ? { id, index: i } : null) // native-ok
      .filter(Boolean) as { id: string; index: number }[];
    for (const { id, index } of pinnedPositions) {
      result.splice(index, 0, id); // native-ok
    }

    onColumnOrderChange(result);
  }, [currentOrder, allColumnIds, visibleColumnIds, lockedIds, onColumnOrderChange]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  return { activeId, sensors, handleDragStart, handleDragEnd, handleDragCancel };
}
