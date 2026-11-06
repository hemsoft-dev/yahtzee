import type { chromium as originalChromium } from "playwright";
export const chromium: typeof originalChromium;
export const clickObservation: {
  begin(): void;
  complete(failed: boolean): void;
  close(): void;
};
