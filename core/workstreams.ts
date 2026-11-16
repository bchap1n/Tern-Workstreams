// Core: discover Obsidian workstream notes and summarize them. Shared by the
// Tern plugin (through cli.ts) and the omp extension.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Status = "active" | "draft" | "monitoring" | "reference" | "closed" | string;

export interface Workstream {
	/** Stable id: `<root label>/<relative path without .md>`. */
	id: string;
	name: string;
	root: string;
	/** Absolute path of the main note. */
	file: string;
	status: Status;
	/** The one-line `## Status` summary. */
	summary: string;
	/** Open `## Next` items. */
	next: string[];
	/** Some `## Next` item waits on the user (`(user)`). */
	waitingOnUser: boolean;
	/** Checkbox progress across the note, or null when it has none. */
	progress: { done: number; total: number } | null;
	/** Newest session id in the `## Sessions` table, if any. */
	session: string | null;
	/** Latest activity: max(note mtime, newest `## Log` date), epoch ms. */
	updated: number;
	ageDays: number;
	closed: boolean;
}

export interface Config {
	/** Workstream directories to scan. */
	roots: string[];
}

/** What the config file holds: pinned roots (optional) and the folders turned off in the panel. */
interface RawConfig {
	roots?: string[];
	hidden?: string[];
}

/** `TERN_WORKSTREAMS_CONFIG` points the plugin at another file; tests use it. */
export function configPath(): string {
	return process.env.TERN_WORKSTREAMS_CONFIG ?? path.join(os.homedir(), ".config", "tern-workstreams", "config.json");
}

/** Paths compare case-insensitively: vaults live on Windows drives and case drifts. */
function pathKey(p: string): string {
	return path.resolve(p).toLowerCase();
}

function readConfig(): RawConfig {
	try {
		return JSON.parse(fs.readFileSync(configPath(), "utf8")) as RawConfig;
	} catch {
		return {};
	}
}

/** The candidate folders before `hidden` removes any: the pinned `roots`, else every vault's workstreams dir. */
function declaredRoots(raw: RawConfig): string[] {
	return Array.isArray(raw.roots) && raw.roots.length > 0 ? raw.roots : discoverRoots();
}

function hiddenKeys(raw: RawConfig): Set<string> {
	return new Set((raw.hidden ?? []).map(pathKey));
}

/** Reads the config, else finds every Obsidian vault with a `workstreams` dir (any case). */
export function loadConfig(): Config {
	const raw = readConfig();
	const hidden = hiddenKeys(raw);
	return { roots: declaredRoots(raw).filter(r => !hidden.has(pathKey(r))) };
}

export interface RootInfo {
	path: string;
	/** The vault directory name, which is what a person recognizes. */
	label: string;
	enabled: boolean;
	/** Workstreams this folder contributes while it is on. */
	count: number;
}

/** Every candidate folder with its on/off state; `w` in the panel flips them. */
export function listRoots(): RootInfo[] {
	const raw = readConfig();
	const hidden = hiddenKeys(raw);
	return declaredRoots(raw).map(p => {
		const enabled = !hidden.has(pathKey(p));
		return {
			path: p,
			label: path.basename(path.dirname(p)) || p,
			enabled,
			count: listWorkstreams({ config: { roots: [p] } }).length,
		};
	});
}

/** Turns one folder on or off and saves the choice; returns the refreshed list. */
export function toggleRoot(rootPath: string): RootInfo[] {
	const raw = readConfig();
	const key = pathKey(rootPath);
	const wasHidden = hiddenKeys(raw).has(key);
	const next = (raw.hidden ?? []).filter(p => pathKey(p) !== key);
	if (!wasHidden) next.push(path.resolve(rootPath));
	const saved: RawConfig = { ...raw, hidden: next };
	fs.mkdirSync(path.dirname(configPath()), { recursive: true });
	fs.writeFileSync(configPath(), `${JSON.stringify(saved, null, 2)}\n`);
	return listRoots();
}

function obsidianJson(): string {
	if (process.platform === "win32") return path.join(process.env.APPDATA ?? "", "obsidian", "obsidian.json");
	if (process.platform === "darwin")
		return path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
	return path.join(os.homedir(), ".config", "obsidian", "obsidian.json");
}

export function discoverRoots(): string[] {
	let vaults: { path: string; open?: boolean; ts?: number }[] = [];
	try {
		vaults = Object.values(JSON.parse(fs.readFileSync(obsidianJson(), "utf8")).vaults ?? {});
	} catch {
		return [];
	}
	vaults.sort((a, b) => Number(!!b.open) - Number(!!a.open) || (b.ts ?? 0) - (a.ts ?? 0));
	const roots: string[] = [];
	for (const v of vaults) {
		let names: string[] = [];
		try {
			names = fs.readdirSync(v.path);
		} catch {
			continue;
		}
		const hit = names.find(n => n.toLowerCase() === "workstreams");
		if (hit) roots.push(path.join(v.path, hit));
	}
	return roots;
}

function frontmatter(text: string): { fm: Record<string, string>; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!m) return { fm: {}, body: text };
	const fm: Record<string, string> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (kv) fm[kv[1].toLowerCase()] = kv[2].replace(/\s+#.*$/, "").trim();
	}
	return { fm, body: text.slice(m[0].length) };
}

function section(body: string, heading: string): string {
	const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi");
	return re.exec(body)?.[1] ?? "";
}

/** Parses one note; `name`/`id` come from the caller. */
export function parseNote(text: string, mtime: number, now = Date.now()) {
	const { fm, body } = frontmatter(text);
	const summary =
		section(body, "Status")
			.split(/\r?\n/)
			.map(s => s.trim())
			.find(Boolean) ?? "";
	const next = section(body, "Next")
		.split(/\r?\n/)
		.map(s => /^\s*[-*]\s+(?!\[x\])(?:\[ \]\s*)?(.+)$/i.exec(s)?.[1]?.trim())
		.filter((s): s is string => !!s);
	const done = (body.match(/^\s*[-*]\s+\[x\]/gim) ?? []).length;
	const open = (body.match(/^\s*[-*]\s+\[ \]/gm) ?? []).length;
	let session: string | null = null;
	const rows = section(body, "Sessions")
		.split(/\r?\n/)
		.filter(l => l.trim().startsWith("|"));
	if (rows.length > 2) {
		const cells = (l: string) => l.split("|").slice(1, -1).map(c => c.trim());
		const col = cells(rows[0]).findIndex(c => /session/i.test(c));
		for (const r of rows.slice(2)) {
			const v = col >= 0 ? cells(r)[col] : undefined;
			if (v && !/^-+$/.test(v)) session = v;
		}
	}
	let updated = mtime;
	for (const m of section(body, "Log").matchAll(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})/gm)) {
		const t = Date.parse(`${m[1]}T12:00:00Z`);
		if (t > updated) updated = t;
	}
	const status = (fm.status || "active").toLowerCase();
	return {
		status,
		summary,
		next,
		waitingOnUser: next.some(n => /\(user\)/i.test(n)),
		progress: done + open > 0 ? { done, total: done + open } : null,
		session,
		updated,
		ageDays: Math.max(0, (now - updated) / 86_400_000),
		closed: status === "closed",
	};
}

/** The main note of a folder workstream: plan.md, index.md, README.md, `<folder>.md`, else the newest note. */
function mainNote(dir: string): string | null {
	const mds = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".md"));
	if (mds.length === 0) return null;
	const want = ["plan.md", "index.md", "readme.md", `${path.basename(dir).toLowerCase()}.md`];
	const hit = mds.find(f => want.includes(f.toLowerCase()));
	if (hit) return path.join(dir, hit);
	return mds.map(f => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/** Lists workstreams, newest first. `_closed/` and closed notes only with `all`. */
export function listWorkstreams(opts: { all?: boolean; config?: Config } = {}): Workstream[] {
	const { roots } = opts.config ?? loadConfig();
	const out: Workstream[] = [];
	const visit = (root: string, dir: string) => {
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".") || e.name.toLowerCase() === "_template.md") continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory() && e.name.toLowerCase() === "_closed") {
				if (opts.all) visit(root, full);
				continue;
			}
			const file = e.isDirectory() ? mainNote(full) : e.name.toLowerCase().endsWith(".md") ? full : null;
			if (!file) continue;
			const rel = path.relative(root, full).replace(/\\/g, "/").replace(/\.md$/i, "");
			const ws: Workstream = {
				id: `${path.basename(path.dirname(root)).replace(/^_obsidian_?/, "") || "vault"}/${rel}`,
				name: e.isDirectory() ? e.name : e.name.replace(/\.md$/i, ""),
				root,
				file,
				...parseNote(fs.readFileSync(file, "utf8"), fs.statSync(file).mtimeMs),
			};
			if (dir !== root && path.basename(dir).toLowerCase() === "_closed") ws.closed = true;
			if (ws.closed && !opts.all) continue;
			out.push(ws);
		}
	};
	for (const r of roots) visit(r, r);
	return out.sort((a, b) => b.updated - a.updated);
}

/** Finds by exact id, then case-insensitive name/id substring. */
export function findWorkstream(query: string, list = listWorkstreams({ all: true })): Workstream | undefined {
	const q = query.toLowerCase();
	return (
		list.find(w => w.id === query) ??
		list.find(w => w.name.toLowerCase() === q) ??
		list.find(w => w.id.toLowerCase().includes(q))
	);
}

export const STATUS_ICON: Record<string, string> = {
	active: "●",
	draft: "◌",
	monitoring: "◉",
	reference: "▣",
	closed: "✓",
};

export function statusIcon(w: Workstream): string {
	return w.waitingOnUser && !w.closed ? "⚑" : (STATUS_ICON[w.status] ?? "○");
}

/** fresh <1d, recent <3d, aging <7d, stale <14d, cold beyond. */
export function ageBand(days: number): "fresh" | "recent" | "aging" | "stale" | "cold" {
	return days < 1 ? "fresh" : days < 3 ? "recent" : days < 7 ? "aging" : days < 14 ? "stale" : "cold";
}

export function ageText(days: number): string {
	if (days < 1 / 24) return "now";
	if (days < 1) return `${Math.floor(days * 24)}h`;
	if (days < 60) return `${Math.floor(days)}d`;
	return `${Math.floor(days / 30)}mo`;
}

/** The prompt that seeds a new omp session for a workstream. */
export function seedPrompt(w: Workstream): string {
	return `Resume workstream "${w.name}". Read the note at ${w.file} (status, next steps, log), then continue from its Next section.`;
}
