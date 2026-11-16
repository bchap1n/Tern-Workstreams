// omp half: `/workstreams list` prints the picker as a table, and
// `/workstreams switch [name]` seeds the selected workstream's prompt into this
// session. Same core as the Tern block, so both agree on statuses and ages.
// @ts-nocheck — the type-only imports are erased at load time and this repo
// builds without the oh-my-pi workspace on disk.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { ageText, findWorkstream, listWorkstreams, seedPrompt, statusIcon } from "../core/workstreams";

/** Prints to the terminal outside the TUI; a toast there would be invisible. */
function say(
	ctx: { mode: string; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } },
	text: string,
	warn = false,
): void {
	if (ctx.mode === "tui") ctx.ui.notify(text, warn ? "warning" : "info");
	else process.stdout.write(`${text}\n`);
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("workstreams", {
		description: "List Obsidian workstreams, or switch to one (list | switch [name])",
		handler: async (args, ctx) => {
			const [verb = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean);

			if (verb === "list") {
				const list = listWorkstreams({ all: rest.includes("--all") });
				if (list.length === 0) {
					say(ctx, "No workstreams found. Set roots in ~/.config/tern-workstreams/config.json", true);
					return;
				}
				const width = Math.max(...list.map(w => w.name.length));
				const lines = list.map(w => {
					const progress = w.progress ? `${w.progress.done}/${w.progress.total}`.padStart(6) : "      ";
					const state = w.waitingOnUser ? "needs you" : w.status;
					return `${statusIcon(w)} ${w.name.padEnd(width)}  ${progress}  ${ageText(w.ageDays).padStart(3)}  ${state}`;
				});
				say(ctx, `Workstreams\n${lines.join("\n")}`);
				return;
			}

			if (verb !== "switch") {
				say(ctx, "Usage: /workstreams list | switch [name]", true);
				return;
			}

			const list = listWorkstreams();
			const query = rest.join(" ");
			let target = query ? findWorkstream(query, list) : undefined;
			if (!query) {
				const label = await ctx.ui.select(
					"Resume which workstream?",
					list.map(w => ({
						label: `${statusIcon(w)} ${w.name}`,
						description: `${w.status} · ${ageText(w.ageDays)} · ${w.summary}`,
					})),
				);
				target = label ? list.find(w => label.endsWith(w.name)) : undefined;
			}
			if (!target) {
				say(ctx, query ? `No workstream matches "${query}"` : "No workstream selected", true);
				return;
			}
			say(ctx, `Resuming ${target.name}`);
			await pi.sendUserMessage(seedPrompt(target));
		},
	});
}
