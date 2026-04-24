import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  DEFAULT_FILTERS,
  useFilters,
} from '../../../../src/gui/renderer/library-shell/useFilters.js';

describe('useFilters hook', () => {
  test('initial state is DEFAULT_FILTERS', () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
  });

  test('setSearch updates the search field immutably', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setSearch('newton'));
    expect(result.current.filters.search).toBe('newton');
  });

  test('setGrades updates the grades array', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setGrades([9, 10]));
    expect(result.current.filters.grades).toEqual([9, 10]);
  });

  test('applyPreset Incomplete-my-gap sets completeness + clears orthogonal filters', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setGrades([9]));
    act(() => result.current.applyPreset('incomplete-my-gap'));
    expect(result.current.filters.completeness).toBe('incomplete-my-gap');
    expect(result.current.filters.grades).toEqual([]);
  });

  test('reset returns every field to DEFAULT_FILTERS', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setSearch('x'));
    act(() => result.current.setGrades([7]));
    act(() => result.current.reset());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
  });
});
