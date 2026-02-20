import { renderHook, act } from '@testing-library/react';
import { useNaturalLanguageSearch } from './useNaturalLanguageSearch';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('useNaturalLanguageSearch', () => {
    // Save original fetch
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should initialize with empty results', () => {
        const { result } = renderHook(() => useNaturalLanguageSearch());
        expect(result.current.results.resources).toEqual([]);
        expect(result.current.results.patterns).toEqual([]);
        expect(result.current.results.isLoading).toBe(false);
    });

    it('should not search if query is empty', async () => {
        const { result } = renderHook(() => useNaturalLanguageSearch());

        act(() => {
            result.current.search('');
        });

        // Fast-forward timers
        vi.useFakeTimers();
        vi.advanceTimersByTime(500);

        expect(global.fetch).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should call search API when query is provided', async () => {
        const mockResourcesResponse = { resources: [{ name: 'pod-1', kind: 'Pod' }] };
        const mockPatternsResponse = { results: [] };

        (global.fetch as any)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => mockResourcesResponse,
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => mockPatternsResponse,
            });

        vi.useFakeTimers();
        const { result } = renderHook(() => useNaturalLanguageSearch());

        act(() => {
            result.current.search('pod');
        });

        // Advance timers by debounce time
        act(() => {
            vi.advanceTimersByTime(350);
        });

        expect(result.current.results.isLoading).toBe(true);

        // Wait for promises
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('should clear results', () => {
        const { result } = renderHook(() => useNaturalLanguageSearch());
        act(() => {
            result.current.clear();
        });
        expect(result.current.results.resources).toEqual([]);
    });
});
