import { test, expect } from "bun:test";
import { destinations, reportText, reportURL, openDestination } from "../../../apps/mobile/src/support/destinations";

test("reports encode only reviewed content and select the matching public template", () => {
  for (const kind of ["problem", "improvement"] as const) {
    const text = reportText(kind, "Version 1 & build #2\nOS: iOS");
    const url = new URL(reportURL(destinations, kind, text)!);
    expect(url.searchParams.get("body")).toBe(text);
    expect(url.searchParams.get("template")).toBe(kind === "problem" ? "bug_report.md" : "feature_request.md");
  }
});
test("private email stays unavailable until configured", () => {
  expect(reportURL(destinations, "private", "safe")).toBeNull();
  expect(reportURL({ ...destinations, privateEmail: "support@example.com" }, "private", "safe & reviewed")).toBe("mailto:support@example.com?subject=Third%20Roll%20private%20support&body=safe%20%26%20reviewed");
  expect(reportURL({ ...destinations, privateEmail: "x@example.com?bcc=other" }, "private", "safe")).toBeNull();
});
test("offline and missing mail handler failures preserve a useful recovery message", async () => {
  expect(await openDestination("mailto:support@example.com", async () => { throw new Error("No handler"); })).toContain("copy");
  expect(await openDestination("https://example.com", async () => undefined)).toBeNull();
});
