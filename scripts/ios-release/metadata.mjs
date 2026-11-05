// Limits from Apple's App Store Connect references, checked November 4, 2026 EST:
// https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
// https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
// Apple says "characters" without saying how they are counted, and "bytes"
// without naming an encoding. Character fields pass only when the fewest
// (grapheme clusters) and most (UTF-16 code units) plausible counts both fit, so
// this module never picks a count Apple has not published. Keywords use UTF-8.
export const METADATA_LIMITS = Object.freeze({
  name: Object.freeze({ unit: "characters", required: true, min: 2, max: 30 }),
  subtitle: Object.freeze({ unit: "characters", required: true, max: 30 }),
  keywords: Object.freeze({ unit: "UTF-8 bytes", required: true, max: 100 }),
  promotionalText: Object.freeze({ unit: "characters", required: false, max: 170 }),
  description: Object.freeze({ unit: "characters", required: true, max: 4000 }),
});

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

function countRange(text, unit) {
  if (unit === "UTF-8 bytes") {
    const bytes = Buffer.byteLength(text, "utf8");
    return [bytes, bytes];
  }
  return [[...graphemes.segment(text)].length, text.length];
}

function limitBlocker(field, text, { unit, min = 0, max }) {
  const [fewest, most] = countRange(text, unit);
  const counted = `${field} has ${fewest === most ? most : `${fewest} to ${most}`} ${unit}; allowed ${min ? `${min} to ` : "up to "}${max}`;
  if (most < min || fewest > max) return `Listing field outside limit: ${counted}`;
  if (fewest < min || most > max) return `Listing field count ambiguous: ${counted}; Apple does not define the count`;
  return null;
}

// Measures each value exactly as given: no trimming, normalization or banner removal.
export function metadataBlockers(fields) {
  const blockers = [];
  for (const [field, limit] of Object.entries(METADATA_LIMITS)) {
    const value = fields[field];
    if (!limit.required && (value === undefined || value === null)) continue;
    if (typeof value !== "string" || (limit.required && !value.trim())) blockers.push(`Listing field missing: ${field}`);
    else if (!value.isWellFormed()) blockers.push(`Listing field invalid: ${field} is not well-formed Unicode`);
    else {
      const blocker = limitBlocker(field, value, limit);
      if (blocker) blockers.push(blocker);
    }
  }
  return blockers;
}
