# Tern-Workstreams

A [Tern](https://stencil.so/tern) plugin and an omp extension for the
workstream notes in an Obsidian vault. Pick a workstream in a small side pane
and it resumes in an omp pane; the picker hides itself once you choose.

## What it does

- Scans one or more `Workstreams` folders in your Obsidian vaults.
- Shows each workstream as one row: a status icon, its name, the `## Status`
  line or checkbox progress, and the age of its newest activity.
- `⏎` resumes the selection: the panel closes and `omp` opens in its place
  with a prompt that points at the note.
- `v` previews the note in the same pane, which grows to show it; `Esc` returns
  to the list and gives the cells back. `Esc` again closes the panel.
- The same list is available inside omp as `/workstreams`.

| Icon | Meaning |
| --- | --- |
| `●` | `status: active` |
| `◌` | `status: draft` |
| `◉` | `status: monitoring` |
| `▣` | `status: reference` |
| `✓` | `status: closed` |
| `⚑` | A `## Next` item waits on you (`(user)`) |

Age is the newest of the note's modified time and the last date in its
`## Log`. Its color runs fresh (green) through recent, aging, stale (yellow) and
cold (grey).

## Requirements

- Tern 0.8 or later, with `bun` on the PATH of the process that runs your panes
  (the plugin's read bridge is TypeScript).
- Obsidian vaults, each with a `workstreams` or `Workstreams` folder.
- `omp` on the PATH for resuming.

## Install

Tern copies the plugin where your panes run, no checkout needed:

```sh
tern plugin install github.com/bchap1n/Tern-Workstreams --force
```

Clone instead if you also want the `/workstreams` command, which omp loads
from a directory:

```sh
git clone https://github.com/bchap1n/Tern-Workstreams ~/Documents/github/Tern-Workstreams
tern plugin link ~/Documents/github/Tern-Workstreams
```

Then run **Open workstreams** from the palette, or press `alt+shift+w`.
`ctrl+w` cannot work: Tern's keymap preset already owns that chord and
`tern.bind` drops a chord the preset holds, so no plugin can claim it.

Tern windows that were already open before the plugin was installed have only
half of it: the block lives in the session daemon, the palette command and the
route that resumes a pick live in each window. Reload with **Reload plugins**
from the palette (or restart Tern) after installing, or pressing `⏎`/`v` in
the panel asks Windows for an app that opens `workstream:` links.

For omp, add the extension to your `~/.omp/agent/config.yml`:

```yaml
extensions:
  - ~/Documents/github/Tern-Workstreams
```

`/workstreams list` prints the table, `/workstreams switch` opens a selector,
and `/workstreams switch <name>` resumes a named workstream in the current
session.

## Config

The plugin finds every Obsidian vault that has a `workstreams` folder. To pick
your own folders, write `~/.config/tern-workstreams/config.json`:

```json
{ "roots": ["C:/Users/me/OneDrive/_obsidian_work/Workstreams"] }
```

## Note shape

Any Markdown note works; these parts are read when present:

```markdown
---
status: active # active | draft | monitoring | reference | closed
---
# Workstream name

## Status
One line: where this stands now.

## Next
- Next step. Add `(user)` when it waits on you.

## Sessions
| Status | Host | Job ID | Session ID | Purpose |
|---|---|---|---|---|

## Log
- 2026-11-15: what happened.
```

A folder workstream uses `plan.md`, `index.md`, `README.md`, `<folder>.md`, or
else its newest note. Workstreams in `_closed/`, and notes whose frontmatter says
`status: closed`, are hidden until you press `a`.

## Keys

| Key | Does |
| --- | --- |
| `alt+shift+w` | Open the panel from any pane |
| `↑` `↓` / `k` `j` | Move |
| `Home` `End` / `g` `G` | First, last |
| `⏎` / `o` | Resume in an omp pane; the panel hides |
| `v` / `space` | Toggle the note preview, growing or shrinking the pane |
| `Esc` | Back to the list, then close the panel |
| `a` | Show or hide closed workstreams |
| `r` | Read the vault again |

## Check

```sh
bun run check
```

Parses a fixture note and folder and asserts the summary, progress, session,
age and filtering rules.

## Layout

| Path | What |
| --- | --- |
| `plugin.toml` | Tern manifest: the `panel` block. |
| `host.luau` | The block: rows, keys, preview, resume. |
| `window.luau` | Opens the panel, resumes in a pane, resizes it. |
| `cli.ts` | JSON bridge the block runs with `bun`. |
| `core/workstreams.ts` | Vault scan and note parsing, shared by both halves. |
| `omp/workstreams.ts` | The `/workstreams` command. |

The block owns no panes: it asks the window half for layout through the
`workstream:` link route.
