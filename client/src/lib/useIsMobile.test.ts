import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./useIsMobile";

function stubMatchMedia(initial: boolean) {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = {
    matches: initial,
    media: "(max-width: 767px)",
    addEventListener: vi.fn((_t: string, fn: any) => {
      listener = fn;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    mql,
    fire: (matches: boolean) =>
      act(() => {
        listener?.({ matches });
      }),
  };
}

describe("useIsMobile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the media query state and follows changes", () => {
    const { fire } = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    fire(true);
    expect(result.current).toBe(true);
  });

  it("defaults to desktop when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("removes the listener on unmount", () => {
    const { mql } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
