"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The dev preview's click-through (/dev/onboarding): inside it, a step's
 * Continue and Skip go to `next` instead of saving, since there is no
 * account or database behind the preview. Outside it (every real page)
 * there is no provider and the steps save as usual.
 */
const PreviewNext = createContext<string | null>(null);

export function PreviewFlow({ next, children }: { next: string; children: ReactNode }) {
  return <PreviewNext.Provider value={next}>{children}</PreviewNext.Provider>;
}

/** The preview's next screen, or null on a real page. */
export function usePreviewNext(): string | null {
  return useContext(PreviewNext);
}
