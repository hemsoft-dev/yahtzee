/** Generated manifests, runtime references and persisted overrides must agree. */
export function pinErrors(source, lock) {
  source = source.replace(/\r\n/g, "\n");
  const errors = [];
  const manifestLine = source.split("\n").find((line) => line.startsWith("# gh-aw-manifest: "));
  if (!manifestLine) return ["Generated workflow action manifest is missing."];
  const manifest = JSON.parse(manifestLine.slice("# gh-aw-manifest: ".length));
  if (!Array.isArray(manifest.actions) || !manifest.actions.length) return ["Generated workflow action manifest is empty."];
  const actions = new Map(manifest.actions.map((action) => [action.repo, action]));
  const references = [...source.matchAll(/^\s+uses:\s+([^\s@]+)@([^\s#]+)(?:\s+#\s+(\S+))?/gm)];
  if (!references.length) errors.push("Generated workflow has no runtime action references.");
  for (const [, repo, sha, version] of references) {
    const action = actions.get(repo);
    if (!action || action.sha !== sha || action.version !== version) errors.push(`Runtime pin differs from manifest: ${repo}@${sha} # ${version}`);
  }
  for (const action of manifest.actions) {
    const summary = `#   - ${action.repo}@${action.sha} # ${action.version}`;
    if (!source.split("\n").includes(summary)) errors.push(`Action summary differs from manifest: ${action.repo}`);
    if (!references.some(([, repo]) => repo === action.repo)) errors.push(`Manifest action has no runtime reference: ${action.repo}`);
  }
  for (const [key, pin] of Object.entries(lock.entries)) {
    const action = actions.get(pin.repo);
    if (key !== `${pin.repo}@${pin.version}` || !action || action.sha !== pin.sha || action.version !== pin.version)
      errors.push(`Persisted action lock differs from manifest: ${key}`);
  }
  for (const repo of ["github/gh-aw-actions/setup", "actions/download-artifact"]) {
    const action = actions.get(repo);
    if (!action || !Object.hasOwn(lock.entries, `${repo}@${action.version}`))
      errors.push(`Required action override missing from lock: ${repo}`);
  }
  return errors;
}
