/** Public destinations only. Set privateEmail/appStoreId when those release values exist. */
export interface SupportDestinations {
  repository: string;
  privacy: string;
  security: string;
  privateEmail: string | null;
  appStoreId: string | null;
}
export const destinations: SupportDestinations = {
  repository: "https://github.com/hemsoft-dev/yahtzee",
  privacy: "https://github.com/hemsoft-dev/yahtzee/blob/main/apps/mobile/PRIVACY.md",
  security: "https://github.com/hemsoft-dev/yahtzee/blob/main/SECURITY.md",
  privateEmail: null,
  appStoreId: null,
};
export type ReportKind = "problem" | "improvement" | "private";
export function reportText(kind: ReportKind, diagnostics: string): string {
  const heading = kind === "improvement" ? "Suggest an improvement" : kind === "private" ? "Private support request" : "Report a problem";
  return `Third Roll: ${heading}\n\nDescribe your ${kind === "improvement" ? "idea and how it helps" : "problem, expected behavior and steps to reproduce"} here.\nDo not include names, saved games, score history, identifiers, credentials or private screenshots.\n\n${diagnostics}`;
}
export function reportURL(config: SupportDestinations, kind: ReportKind, text: string): string | null {
  if (kind === "private") {
    if (!config.privateEmail || !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(config.privateEmail)) return null;
    return `mailto:${config.privateEmail}?subject=${encodeURIComponent("Third Roll private support")}&body=${encodeURIComponent(text)}`;
  }
  const template = kind === "problem" ? "bug_report.md" : "feature_request.md";
  return `${config.repository}/issues/new?template=${template}&body=${encodeURIComponent(text)}`;
}
export function reviewURL(config: SupportDestinations): string | null {
  return config.appStoreId && /^[1-9]\d*$/.test(config.appStoreId)
    ? `https://apps.apple.com/app/id${config.appStoreId}?action=write-review` : null;
}
/** Only explicit user actions call this. Rejection covers offline browsers and missing mail handlers. */
export async function openDestination(url: string, open: (url: string) => Promise<unknown>): Promise<string | null> {
  try { await open(url); return null; }
  catch { return "Could not open this destination. Check your connection or installed browser/mail app. You can select and copy the details below, then try again later."; }
}
