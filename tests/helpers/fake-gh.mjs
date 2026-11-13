/**
 * Fake `gh` for the GitHub step tests, used through `AF_GH_CMD`
 * (`["node", "<this file>"]`). State lives in the JSON file named by
 * `FAKE_GH_STATE`:
 *
 * - `pr`: the `gh pr view --json` object (`commits` included)
 * - `reviews`, `comments`: REST API arrays
 * - `checks`: `gh pr checks --json` array; `requiredChecks`: same, or null for
 *   "no required checks reported"
 * - `repo`: `GET /repos/:o/:r` (allow_* flags); `rules`: branch rules
 * - `mergeError`: makes `gh pr merge` fail with this message
 * - `deleteError`: makes the remote branch delete fail with this message
 *   (`deletedBranches` records the encoded branch path of each delete)
 * - `mergeDelayMs`: time a merge takes
 * - `timeline`: `{ "<n>": patch }`, merged into the state at the n-th `pr view`
 *
 * Every call is appended to `<state>.calls.jsonl` as `{ args, cwd, start, end }`.
 * Tests call `fakeGh()` in-process (mocked `runGh`), or run this file as `gh`.
 */

import {
  appendFileSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Runs one fake `gh` call. Returns `{ code, stdout, stderr }`, like the real
 * runner; `options.env.FAKE_GH_STATE` names the state file.
 */
export async function fakeGh(args, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const file = env.FAKE_GH_STATE;
  const start = Date.now();
  let stdout = "";
  const load = () => JSON.parse(readFileSync(file, "utf-8"));
  const save = (state) => {
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${file}.tmp`, file);
  };
  const log = (extra = {}) =>
    appendFileSync(
      `${file}.calls.jsonl`,
      `${JSON.stringify({ args, cwd, start, end: Date.now(), ...extra })}\n`
    );
  const out = (value) => {
    stdout = typeof value === "string" ? value : JSON.stringify(value);
  };
  const fail = (message, code = 1) => {
    log({ failed: message });
    return { code, stdout, stderr: message };
  };

  let state = load();
  const [cmd, sub] = args;

  if (cmd === "pr" && sub === "view") {
    state._views = (state._views ?? 0) + 1;
    const patch = state.timeline?.[String(state._views)];
    if (patch) Object.assign(state, patch);
    save(state);
    log();
    out(state.pr);
  } else if (cmd === "pr" && sub === "checks") {
    const required = args.includes("--required");
    const list = required ? state.requiredChecks : state.checks;
    log();
    if (list == null || list.length === 0) {
      return fail(
        `no ${required ? "required " : ""}checks reported on the '${state.pr.headRefName}' branch`
      );
    }
    out(list);
    if (list.some((c) => c.bucket === "pending"))
      return { code: 8, stdout, stderr: "" };
    if (list.some((c) => c.bucket === "fail"))
      return { code: 1, stdout, stderr: "" };
  } else if (cmd === "pr" && sub === "comment") {
    const body = args[args.indexOf("--body") + 1];
    state.comments = [
      ...(state.comments ?? []),
      {
        id: Date.now(),
        user: { login: "operator" },
        body,
        created_at: new Date().toISOString(),
        html_url: null
      }
    ];
    state.triggers = [...(state.triggers ?? []), body];
    save(state);
    log();
  } else if (cmd === "pr" && sub === "merge") {
    if (state.mergeDelayMs)
      await new Promise((r) => setTimeout(r, state.mergeDelayMs));
    state = load();
    if (state.mergeError) return fail(state.mergeError);
    state.pr.state = "MERGED";
    state.merges = (state.merges ?? 0) + 1;
    save(state);
    log();
  } else if (cmd === "api") {
    const route = args.find((a) => a.startsWith("repos/")) ?? "";
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    log();
    if (/\/pulls\/\d+\/reviews/.test(route)) out(state.reviews ?? []);
    else if (/\/issues\/\d+\/comments/.test(route)) out(state.comments ?? []);
    else if (/\/rules\/branches\//.test(route)) out(state.rules ?? []);
    else if (method === "DELETE" && /\/git\/refs\/heads\//.test(route)) {
      if (state.deleteError) return fail(state.deleteError);
      state.deletedBranches = [
        ...(state.deletedBranches ?? []),
        route.split("/heads/")[1]
      ];
      save(state);
    } else if (/^repos\/[^/]+\/[^/?]+$/.test(route)) out(state.repo ?? {});
    else return fail(`fake gh: unknown api route ${route}`);
  } else {
    return fail(`fake gh: unsupported command ${args.join(" ")}`);
  }
  return { code: 0, stdout, stderr: "" };
}

// As a script (`AF_GH_CMD`): one call with the process arguments
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await fakeGh(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.code);
}
