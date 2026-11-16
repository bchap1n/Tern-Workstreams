--!strict
-- The `panel` block: a small workstream picker. Rows carry a status icon, the
-- age of the newest activity and checkbox progress. Enter resumes the selected
-- workstream in an omp pane and the panel hides itself; v (or space) toggles a
-- scrollable preview of the note in place.
--
-- The window half owns panes, so this block asks it for layout through the link
-- route: `workstream:switch/<cmd>` (split omp in, close the panel),
-- `workstream:preview` and `workstream:list` (grow and shrink the panel).
local ui = tern.ui

local LIST_KEY = "list"
-- Cells the preview adds to the pane. The preview reads the note; it must not
-- take the screen, and Esc gives even these back.
local PREVIEW_COLS = 18
local LIST_ID = "main.list."
local ROOT_ID = "main.root."

type Row = {
	id: string,
	name: string,
	icon: string,
	status: string,
	summary: string,
	next: { string },
	waiting: boolean,
	progress: { done: number, total: number }?,
	age: string,
	band: string,
	closed: boolean,
	cwd: string,
	prompt: string,
}

type Root = {
	path: string,
	label: string,
	enabled: boolean,
	count: number,
}

type State = {
	cx: BlockCx,
	rows: { Row }?,
	-- Non-nil while the folder picker shows instead of the list.
	roots: { Root }?,
	rootCursor: string?,
	shown: { Row },
	cursor: string?,
	preview: string?,
	all: boolean,
	-- Cells the preview grew the pane by; 0 while the list shows.
	grown: number,
	problem: string?,
	loading: boolean,
}

local BAND_TONE: { [string]: string } = {
	fresh = "success",
	recent = "info",
	aging = "neutral",
	stale = "warning",
	cold = "muted",
}

local function running(pane: number): boolean
	for _, p in tern.pane.list() do
		if p.pane == pane then
			return true
		end
	end
	return false
end

-- Runs the bridge script bundled beside this plugin; `done` gets the parsed JSON.
local function bridge(state: State, args: { string }, done: (any) -> ())
	state.loading = true
	local argv = { "bun", "cli.ts" }
	for _, a in args do
		table.insert(argv, a)
	end
	tern.process.run(argv, { cwd = tern.plugin.dir, timeout_ms = 15000 }, function(r: ProcessResult, _)
		if not running(state.cx.pane) then
			return
		end
		state.loading = false
		if r.status ~= 0 then
			local detail = (r.stderr ~= "" and r.stderr or r.stdout):gsub("%s+$", "")
			state.problem = if r.status == -1 or r.timed_out
				then "The bridge script did not finish. Is `bun` on the daemon's PATH?"
				else "Could not read the vault: " .. detail
			state.cx:render()
			return
		end
		local ok, value = pcall(tern.json.decode, r.stdout)
		if not ok then
			state.problem = "The bridge script returned no JSON."
		else
			state.problem = nil
			done(value)
		end
		state.cx:render()
	end)
end

local function refilter(state: State)
	local shown: { Row } = {}
	for _, row in state.rows or {} do
		if state.all or not row.closed then
			table.insert(shown, row)
		end
	end
	state.shown = shown
	if state.cursor == nil or not state.shown[1] then
		state.cursor = if state.shown[1] then state.shown[1].id else nil
	end
end

local function load(state: State)
	state.rows = nil
	bridge(state, { "list" }, function(rows)
		state.rows = rows
		refilter(state)
	end)
end

local function load_roots(state: State)
	bridge(state, { "roots" }, function(roots)
		state.roots = roots
		if state.rootCursor == nil or not roots[1] then
			state.rootCursor = if roots[1] then roots[1].path else nil
		end
	end)
end

-- Flips one folder on or off; the bridge returns the refreshed folder list.
local function toggle_root(state: State)
	local cursor = state.rootCursor
	if cursor == nil then
		return
	end
	bridge(state, { "toggle", cursor }, function(roots)
		state.roots = roots
		-- The visible workstreams changed, so the list behind the picker must reload.
		load(state)
	end)
end

local function index_of(state: State): number
	for i, row in state.shown do
		if row.id == state.cursor then
			return i
		end
	end
	return 1
end

local function move(state: State, to: number)
	local row = state.shown[math.clamp(to, 1, math.max(1, #state.shown))]
	if row then
		state.cursor = row.id
	end
end

local function selected(state: State): Row?
	return state.shown[index_of(state)]
end

-- Quotes one argument for the login shell (pwsh on Windows, a POSIX shell
-- elsewhere): both take single quotes, escaping differently. The window half
-- hands the rest of the line to the shell unquoted, so only the argument is wrapped.
local function quote(text: string): string
	if tern.runtime.os == "windows" then
		return "'" .. text:gsub("'", "''") .. "'"
	end
	return "'" .. text:gsub("'", "'\\''") .. "'"
end

local function resume(state: State, cx: BlockCx)
	local row = selected(state)
	if not row then
		return
	end
	cx:open("workstream:switch/omp " .. quote(row.prompt))
end

local function toggle_preview(state: State, cx: BlockCx)
	local row = selected(state)
	if not row then
		return
	end
	if state.preview ~= nil then
		state.preview = nil
		cx:open("workstream:resize/" .. tostring(-state.grown))
		state.grown = 0
		return
	end
	bridge(state, { "show", row.id }, function(note)
		state.preview = note.markdown
		state.grown = PREVIEW_COLS
		cx:open("workstream:resize/" .. tostring(PREVIEW_COLS))
	end)
end

-- A list of `max` lines keeps its selected row in view; list rows are about a
-- third taller than cells, and the dock takes about three.
local function list_lines(cx: BlockCx): number
	return math.max(3, math.floor((cx.rows - 3) * 0.72))
end

local function row_label(row: Row): { Span | string }
	local label: { Span | string } = {
		ui.span(row.icon .. " ", if row.waiting then "warning" elseif row.closed then "muted" else "success"),
		ui.span(row.name),
	}
	if row.waiting then
		table.insert(label, ui.span("  user", "warning"))
	end
	return label
end

local function row_detail(row: Row): Span?
	if row.progress then
		local p = row.progress :: { done: number, total: number }
		local filled = math.floor(p.done / p.total * 5 + 0.5)
		return ui.span(string.rep("▮", filled) .. string.rep("▯", 5 - filled) .. " " .. p.done .. "/" .. p.total, "muted")
	end
	if row.summary ~= "" then
		return ui.span(row.summary, "dim")
	end
	return nil
end

local function roots_view(state: State): Node
	local items: { Item } = {}
	for _, root in state.roots or {} do
		table.insert(items, {
			label = { ui.span(if root.enabled then "✓ " else "· ", if root.enabled then "success" else "muted"), ui.span(root.label) },
			detail = ui.span(root.path, "dim"),
			value = ui.span(tostring(root.count) .. " ws", if root.enabled then "neutral" else "muted"),
			tone = if root.enabled then nil else "muted",
		})
	end
	local list = ui.list(items)
	for i, root in state.roots or {} do
		local kids = list.c or {}
		local p: { [string]: any } = kids[i].p or {}
		p.key = root.path
		kids[i].p = p
	end
	local p: { [string]: any } = list.p or {}
	p.key = "main.roots"
	p.selected = if state.rootCursor then ROOT_ID .. state.rootCursor else nil
	p.empty = { ui.span("No Obsidian vault has a workstreams dir.", "muted") }
	p.max = { lines = list_lines(state.cx) }
	list.p = p
	return list
end

local function list_view(state: State): Node
	local items: { Item } = {}
	for _, row in state.shown do
		table.insert(items, {
			label = row_label(row),
			detail = row_detail(row),
			value = ui.span(row.age, BAND_TONE[row.band] or "muted"),
			tone = if row.closed then "muted" else nil,
		})
	end
	local list = ui.list(items)
	-- Keyed by workstream id so a row keeps its identity when the list is sorted
	-- or a closed workstream is hidden.
	for i, row in state.shown do
		local kids = list.c or {}
		local p: { [string]: any } = kids[i].p or {}
		p.key = row.id
		kids[i].p = p
	end
	local p: { [string]: any } = list.p or {}
	p.key = LIST_KEY
	p.selected = if state.cursor then LIST_ID .. state.cursor else nil
	p.empty = { ui.span("No workstreams. Press w to turn a folder back on.", "muted") }
	p.max = { lines = list_lines(state.cx) }
	list.p = p
	return list
end

local function preview_view(state: State): Node
	return ui.col({ ui.md(state.preview or "") })
end

local function dock(state: State): Node
	local status: { Span | string } = {}
	if state.loading then
		table.insert(status, ui.span("loading…", "muted"))
	else
		if state.roots ~= nil then
			local on = 0
			for _, root in state.roots do
				if root.enabled then
					on = on + 1
				end
			end
			table.insert(status, ui.span(on .. "/" .. #state.roots .. " folders", "strong"))
		else
			table.insert(status, ui.span(#state.shown .. " workstreams", "strong"))
			if not state.all then
				table.insert(status, ui.span("  closed hidden", "muted"))
			end
		end
	end
	local keys = if state.roots ~= nil
		then "⏎ on/off  esc back"
		elseif state.preview ~= nil then "esc back  ⏎ resume"
		else "↑↓ move  ⏎ resume  v preview  a all  w folders  r refresh"
	return ui.col({
		ui.lines({
			ui.text(status),
			ui.text({ ui.span(keys, "dim") }),
		}),
	})
end

-- Keys inside the folder picker. Enter flips the folder under the cursor.
local function root_key(state: State, key: Key, k: string?): boolean
	local roots = state.roots or {}
	local at = 1
	for i, root in roots do
		if root.path == state.rootCursor then
			at = i
		end
	end
	if key.name == "escape" or k == "w" or k == "q" then
		state.roots = nil
		return true
	elseif key.name == "up" or k == "k" then
		at = math.clamp(at - 1, 1, math.max(1, #roots))
	elseif key.name == "down" or k == "j" then
		at = math.clamp(at + 1, 1, math.max(1, #roots))
	elseif key.name == "enter" or key.name == "space" or k == "o" then
		toggle_root(state)
		return true
	else
		return false
	end
	if roots[at] then
		state.rootCursor = roots[at].path
	end
	return true
end

tern.block.define("panel", {
	init = function(cx: BlockCx, _args: { string }, _saved: any): State
		local state: State = {
			cx = cx,
			rows = nil,
			roots = nil,
			rootCursor = nil,
			shown = {},
			cursor = nil,
			preview = nil,
			all = false,
			grown = 0,
			problem = nil,
			loading = false,
		}
		load(state)
		return state
	end,

	title = function(state: State): string?
		if state.roots ~= nil then
			return "Workstreams · folders"
		end
		if state.preview ~= nil then
			local row = selected(state)
			return "Workstreams · " .. (if row then row.name else "note")
		end
		return "Workstreams"
	end,

	view = function(state: State, _cx: BlockCx): BlockView
		local main: Node
		if state.roots ~= nil then
			main = roots_view(state)
		elseif state.preview ~= nil then
			main = preview_view(state)
		elseif state.problem then
			main = ui.md("**" .. state.problem .. "**")
		elseif state.rows then
			main = list_view(state)
		else
			main = ui.progress(nil, "Reading workstreams…")
		end
		return { main = ui.col({ main }), dock = dock(state) }
	end,

	key = function(state: State, key: Key, cx: BlockCx): boolean?
		if key.ctrl or key.alt or key.meta then
			return false
		end
		local k = key.text or key.name
		if state.roots ~= nil then
			return root_key(state, key, k)
		end
		if key.name == "escape" then
			if state.preview ~= nil then
				toggle_preview(state, cx)
			else
				cx:exit(0)
			end
		elseif key.name == "up" or k == "k" then
			move(state, index_of(state) - 1)
		elseif key.name == "down" or k == "j" then
			move(state, index_of(state) + 1)
		elseif key.name == "home" or k == "g" then
			move(state, 1)
		elseif key.name == "end" or k == "G" then
			move(state, #state.shown)
		elseif key.name == "enter" or k == "o" then
			resume(state, cx)
		elseif k == "v" or key.name == "space" then
			toggle_preview(state, cx)
		elseif k == "a" then
			state.all = not state.all
			refilter(state)
		elseif k == "w" then
			state.preview = nil
			load_roots(state)
		elseif k == "r" then
			state.preview = nil
			load(state)
		else
			return false
		end
		return true
	end,

	event = function(state: State, ev: UiEvent, cx: BlockCx)
		if (ev.ev == "select" or ev.ev == "activate") and type(ev.item) == "string" then
			if string.sub(ev.item, 1, #ROOT_ID) == ROOT_ID then
				state.rootCursor = string.sub(ev.item, #ROOT_ID + 1)
				if ev.ev == "activate" then
					toggle_root(state)
				end
				return
			end
			state.cursor = string.sub(ev.item, #LIST_ID + 1)
			if state.preview ~= nil then
				state.preview = nil
			end
			if ev.ev == "activate" then
				resume(state, cx)
			end
		end
	end,

	save = function(state: State): any
		return { all = state.all }
	end,
})
