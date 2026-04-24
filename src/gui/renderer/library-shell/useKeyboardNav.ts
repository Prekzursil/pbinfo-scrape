import { useEffect, useRef, useState, type RefObject } from 'react';
import type { FixedSizeList } from 'react-window';

import type { ProblemRowInput } from '../../main/library-repository.js';

export interface UseKeyboardNavInput {
  readonly rows: readonly ProblemRowInput[];
  readonly selectedId: string | undefined;
  readonly onOpenRow: (id: string) => void;
  readonly listRef: RefObject<FixedSizeList | null>;
  readonly focusSearch: () => void;
  readonly focusFilters: () => void;
  readonly onEscape: () => void;
}

export function useKeyboardNav(input: UseKeyboardNavInput): {
  readonly selectedIndex: number;
} {
  const {
    rows,
    selectedId,
    onOpenRow,
    listRef,
    focusSearch,
    focusFilters,
    onEscape,
  } = input;

  const initialIndex = Math.max(
    0,
    rows.findIndex((r) => r.id === selectedId),
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const indexRef = useRef(selectedIndex);
  indexRef.current = selectedIndex;

  useEffect(() => {
    const isShortcut = (event: KeyboardEvent, key: string): boolean => {
      const lower = event.key.toLowerCase();
      if (lower !== key) return false;
      return event.ctrlKey || (event.metaKey && !event.ctrlKey);
    };

    const handler = (event: KeyboardEvent): void => {
      // Global shortcuts take priority over row nav.
      if (isShortcut(event, 'f')) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (isShortcut(event, 'l')) {
        event.preventDefault();
        focusFilters();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }

      // Row nav is suppressed when focus is inside an input / textarea /
      // contenteditable element, so typing still works.
      const activeTag = (document.activeElement?.tagName ?? '').toLowerCase();
      const inEditable =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        document.activeElement?.getAttribute('contenteditable') === 'true';
      if (inEditable) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(rows.length - 1, indexRef.current + 1);
        setSelectedIndex(next);
        listRef.current?.scrollToItem(next);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, indexRef.current - 1);
        setSelectedIndex(next);
        listRef.current?.scrollToItem(next);
      } else if (event.key === 'Enter') {
        const row = rows[indexRef.current];
        if (row) onOpenRow(row.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rows, onOpenRow, listRef, focusSearch, focusFilters, onEscape]);

  return { selectedIndex };
}
