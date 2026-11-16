// CLI bridge for the Tern plugin. Emits JSON on stdout:
//   bun cli.ts list [--all]
//   bun cli.ts show <id-or-name>
import { ageBand, ageText, findWorkstream, listWorkstreams, seedPrompt, statusIcon } from "./core/workstreams";

const [cmd = "list", ...rest] = process.argv.slice(2);

function emit(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (cmd === "list") {
	const all = rest.includes("--all");
	emit(
		listWorkstreams({ all }).map(w => ({
			...w,
			icon: statusIcon(w),
			age: ageText(w.ageDays),
			band: ageBand(w.ageDays),
			prompt: seedPrompt(w),
		})),
	);
} else if (cmd === "show") {
	const w = findWorkstream(rest.join(" "));
	if (!w) {
		process.stderr.write(`no workstream matches "${rest.join(" ")}"\n`);
		process.exit(1);
	}
	const note = await Bun.file(w.file).text();
	emit({
		...w,
		icon: statusIcon(w),
		age: ageText(w.ageDays),
		band: ageBand(w.ageDays),
		// Frontmatter is noise in a preview; the status and next sections carry it.
		markdown: note.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""),
		prompt: seedPrompt(w),
	});
} else {
	process.stderr.write(`usage: cli.ts [list [--all] | show <id-or-name>]\n`);
	process.exit(2);
}
