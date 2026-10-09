import type { VerifiedRemediation } from "./security-remediations";

export interface Exception {
  package: string;
  advisory: string;
  owner: string;
  rationale: string;
  expires: string;
}

/** Reject unknown scanner formats, unreviewed advisories and expired exceptions. */
export function checkAudit(report: unknown, exceptions: Exception[], today: string, repairs: VerifiedRemediation[] = []): string[] {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Invalid audit report");
  }
  for (const entry of exceptions) {
    if (!entry.package || !/^https:\/\/github.com\/advisories\/GHSA-[\w-]+$/.test(entry.advisory)
      || !entry.owner.trim() || !entry.rationale.trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)
      || Number.isNaN(Date.parse(entry.expires))
      || new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires
      || entry.expires <= today) {
      throw new Error("Invalid or expired security exception");
    }
  }
  const failures: string[] = [];
  for (const [name, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories)) throw new Error(`Invalid audit entries for ${name}`);
    for (const advisory of advisories) {
      if (!advisory || typeof advisory.url !== "string" || typeof advisory.severity !== "string") {
        throw new Error(`Invalid advisory for ${name}`);
      }
      if (!exceptions.some((entry) => entry.package === name && entry.advisory === advisory.url)
        && !repairs.some((entry) => entry.package === name && entry.advisory === advisory.url)) {
        failures.push(`${name}: ${advisory.severity} ${advisory.url}`);
      }
    }
  }
  return [...new Set(failures)];
}
