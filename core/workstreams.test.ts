// Self-check: `bun run core/workstreams.test.ts`. Parses one realistic note and
// one folder workstream from a temp vault; fails if any summary drifts.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ageText, findWorkstream, listRoots, listWorkstreams, loadConfig, parseNote, statusIcon, toggleRoot } from "./workstreams";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
const root = path.join(base, "Workstreams");
fs.mkdirSync(path.join(root, "folder-ws"), { recursive: true });
fs.mkdirSync(path.join(root, "_closed"), { recursive: true });

fs.writeFileSync(
	path.join(root, "single note.md"),
	`---
status: monitoring
jira: ABC-1
---
# Single note

## Status
Waiting on legal review.

## Next
- Chase counsel (user)
- Draft the release note

## Sessions
| Status | Host | Job ID | Session ID | Purpose |
|---|---|---|---|---|
| old | h | j1 | s-old | first |
| live | h | j2 | s-live | second |

## Log
- 2026-01-02: sent draft
- 2026-01-05: nudged counsel

- [x] one
- [ ] two
`,
	"utf8",
);
fs.writeFileSync(path.join(root, "folder-ws", "plan.md"), "---\nstatus: active\n---\n# Plan\n\n## Status\nHeld.\n");
fs.writeFileSync(path.join(root, "folder-ws", "notes.md"), "# Other\n");
fs.writeFileSync(path.join(root, "_closed", "old thing.md"), "---\nstatus: closed\n---\n# Old\n");

const now = Date.parse("2026-01-10T12:00:00Z");
const note = parseNote(fs.readFileSync(path.join(root, "single note.md"), "utf8"), Date.parse("2025-12-30T12:00:00Z"), now);
assert.equal(note.status, "monitoring");
assert.equal(note.summary, "Waiting on legal review.");
assert.deepEqual(note.next, ["Chase counsel (user)", "Draft the release note"]);
assert.equal(note.waitingOnUser, true);
assert.deepEqual(note.progress, { done: 1, total: 2 });
assert.equal(note.session, "s-live", "newest session row wins");
// The newest log date (2026-01-05) beats the older file mtime (2025-12-30).
assert.equal(note.ageDays, 5);
assert.equal(note.closed, false);

const list = listWorkstreams({ all: true, config: { roots: [root] } });
assert.deepEqual(
	list.map(w => w.name).sort(),
	["folder-ws", "old thing", "single note"],
	"folders, notes and _closed/ entries all list with all",
);
assert.equal(findWorkstream("folder-ws", list)?.file, path.join(root, "folder-ws", "plan.md"));
assert.equal(findWorkstream("abc", list), undefined);
assert.equal(findWorkstream("Single", list)?.name, "single note", "substring match ignores case");

assert.deepEqual(
	listWorkstreams({ config: { roots: [root] } }).map(w => w.name).sort(),
	["folder-ws", "single note"],
	"closed workstreams hide by default",
);
assert.equal(ageText(0.02), "now");
assert.equal(ageText(0.5), "12h");
assert.equal(ageText(9.7), "9d");
assert.equal(ageText(120), "4mo");
const single = findWorkstream("single note", list);
assert.equal(single && statusIcon(single), "⚑", "a workstream waiting on the user gets the flag icon");

// A folder turned off in the panel stays off across runs and comes back on a
// second toggle; the config file is the only state.
const cfg = path.join(base, "config.json");
process.env.TERN_WORKSTREAMS_CONFIG = cfg;
fs.writeFileSync(cfg, JSON.stringify({ roots: [root], hidden: [root.toUpperCase()] }));
assert.deepEqual(loadConfig().roots, [], "a hidden folder (any case) drops out of the scan");
assert.deepEqual(
	listRoots().map(r => [r.enabled, r.count]),
	[[false, 2]],
	"the picker still lists a hidden folder, off, showing what it holds",
);
assert.deepEqual(toggleRoot(root).map(r => r.enabled), [true], "toggling it back on re-enables it");
assert.deepEqual(loadConfig().roots, [root]);
assert.deepEqual(JSON.parse(fs.readFileSync(cfg, "utf8")), { roots: [root], hidden: [] }, "the choice is saved");

fs.rmSync(base, { recursive: true, force: true });
console.log("ok");
