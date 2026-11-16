--!strict
-- The window half: a palette command and a key bind that open the workstream
-- panel, plus the link route the panel uses to resume a workstream (it owns no
-- panes itself) and to grow or shrink its own pane for the note preview.

local KIND = "workstreams.panel"

local function panel_pane(cx: WindowCx): number?
	for _, pane in cx.session:panes() do
		if pane.title == "Workstreams" or string.sub(pane.title, 1, #"Workstreams ·") == "Workstreams ·" then
			return pane.pane
		end
	end
	return nil
end

local function open_panel(cx: WindowCx)
	local existing = panel_pane(cx)
	if existing then
		cx.layout:focus(existing)
		return
	end
	-- Small on purpose: the panel is a picker, not a workspace. Focus it: a
	-- picker nobody can type into is a pane that steals the split.
	local pane = cx:new_block(KIND, nil, "beside", { ratio = 0.25 })
	if pane == nil then
		cx:toast("error", "Workstreams is not loaded on this host", "Install the plugin where your panes run.")
		return
	end
	cx.layout:focus(pane)
end

-- Moves the panel's nearest divider by `cells` (negative shrinks). The block
-- sends the amount it grew, so the same divider moves back.
local function resize(cx: WindowCx, pane: number, cells: number)
	if not cx.layout:resize(pane, "left", cells) then
		cx.layout:resize(pane, "right", cells)
	end
end

tern.route.link(function(link: LinkRequest, cx: WindowCx): RouteDecision?
	local verb, arg = string.match(link.url, "^workstream:(%a+)/?(.*)$")
	if verb == nil then
		return nil
	end
	if verb == "switch" then
		-- Replaces the panel with the omp pane it launches, so the picker hides
		-- as soon as a choice is made.
		if cx.layout:split(link.pane, "right", { command = arg }) then
			cx.layout:close(link.pane)
		end
	elseif verb == "resize" then
		resize(cx, link.pane, math.floor(tonumber(arg) or 0))
	end
	return { handled = true }
end)

tern.command({
	id = "open",
	title = "Open workstreams",
	icon = "list",
	run = open_panel,
})
-- No default chord: the keymap preset binds most combinations. Bind
-- `plugin.workstreams.open` in Preferences if you want one.

