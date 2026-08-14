from pathlib import Path

ROOT = Path(__file__).resolve().parent

startup = (ROOT / "startup.py").read_text(encoding="utf-8")
entrypoint = (ROOT / "main.py").read_text(encoding="utf-8")
discovery_runtime = (ROOT / "app_v170_runtime.py").read_text(encoding="utf-8")
responsive_runtime = (ROOT / "app_v172_runtime.py").read_text(encoding="utf-8")
tab_runtime = (ROOT / "app_v174_runtime.py").read_text(encoding="utf-8")
tab_fix = (ROOT / "app_v174_runtime_fix.py").read_text(encoding="utf-8")
power_runtime = (ROOT / "app_current.py").read_text(encoding="utf-8")
roster_export = (ROOT / "roster_export.py").read_text(encoding="utf-8")
spec = (ROOT / "AllianceTracker.spec").read_text(encoding="utf-8")
capture = (ROOT / "capture.py").read_text(encoding="utf-8")
agent_prelude = (ROOT / "agent" / "part-01.js").read_text(encoding="utf-8")
agent_mode = (ROOT / "agent" / "part00a.js").read_text(encoding="utf-8")
agent_rpc = (ROOT / "agent" / "part03.js").read_text(encoding="utf-8")
resolver = (ROOT / "agent" / "part04g.js").read_text(encoding="utf-8")
agent_parts = sorted((ROOT / "agent").glob("part*.js"))
agent_source = "\n".join(path.read_text(encoding="utf-8") for path in agent_parts)

assert '1.7.0' in startup
assert 'from app_v170_runtime import App' in startup
assert '1.7.6' in entrypoint
assert 'from app_current import App as CurrentApp' in entrypoint
assert "main.py" in spec

# 1.7.5 global power remains above the dedicated tab list. It launches the
# configured Last Z executable only; attaching/capturing remains an explicit action.
assert '⏻  START WORKSPACE' in power_runtime
assert '⏻  SHUT DOWN' in power_runtime
assert 'gameExecutable' in power_runtime
assert 'subprocess.Popen' in power_runtime
assert 'Survival.exe' in power_runtime
assert 'def toggle_workspace_power' in power_runtime
assert 'self._tile_workspace(0)' in power_runtime
assert 'self.after(250, self._wait_for_survival_window)' in power_runtime
assert 'self.attach()' not in power_runtime
assert 'self._capture_studio_start()' not in power_runtime

# Windows tiling is implemented directly, with no PowerToys/FancyZones dependency.
assert 'MonitorFromWindow' in power_runtime
assert 'GetMonitorInfoW' in power_runtime
assert 'SetWindowPos' in power_runtime
assert 'SW_RESTORE' in power_runtime
assert 'Tracker left / game right layout applied' in power_runtime

# Second press requests a graceful game close, packages any active capture, then
# terminates only Survival.exe if the game ignores WM_CLOSE before exiting Tracker.
assert 'WM_CLOSE' in power_runtime
assert 'PostMessageW' in power_runtime
assert 'TerminateProcess' in power_runtime
assert 'PROCESS_TERMINATE' in power_runtime
assert '_quiet_package_active_capture' in power_runtime
assert 'self.store.package(session_id)' in power_runtime
assert 'self.capture.detach()' in power_runtime
assert 'self.destroy()' in power_runtime

# 1.7.4 intentionally removes the giant Capture Studio scroll surface from the
# active UI. Top-level pages use the original fixed viewport implementation.
assert 'return RootApp.page(self, key, title, subtitle)' in tab_runtime
assert 'def _prepare_responsive_widgets' in tab_runtime
assert 'def _apply_responsive_layout' in tab_runtime
assert 'ctk.CTkScrollableFrame(' not in tab_runtime
assert 'move only the intended section panel' in tab_fix
assert 'return widget.master' in tab_fix

# Specialist functions are first-class left-side destinations instead of sections
# stacked into one canvas.
for page_key in (
    '"polls"',
    '"roster_export"',
    '"discovery"',
    '"sequence_profiles"',
    '"svs_inspector"',
):
    assert page_key in tab_runtime
for label in (
    '"Capture"',
    '"Polls"',
    '"Roster Export"',
    '"Discovery"',
    '"Sessions"',
    '"Sequence Studio"',
    '"Saved Sequences"',
    '"SVS Inspector"',
    '"Replay Test"',
    '"Auto Sync"',
    '"Cloud Sync"',
    '"Settings"',
):
    assert label in tab_runtime

# Poll, roster and discovery functions are preserved and rebound to the dedicated
# page controls rather than removed.
assert 'START POLL CAPTURE' in tab_runtime
assert 'IMPORT POLL ZIP' in tab_runtime
assert 'SYNC SELECTED POLL' in tab_runtime
assert 'START ROSTER CAPTURE' in tab_runtime
assert 'STOP & EXPORT JSON' in tab_runtime
assert 'OPEN LATEST JSON' in tab_runtime
assert 'START DISCOVERY' in tab_runtime
assert 'ADD MARKER' in tab_runtime
assert '_start_discovery_tab_capture' in tab_runtime

# Sequence recording/replay remains in Sequence Studio, while saved profiles and
# State Ruler diagnostics have dedicated pages using the original method contracts.
assert 'SAVE CURRENT SEQUENCE' in tab_runtime
assert 'LOAD SELECTED SEQUENCE' in tab_runtime
assert 'self.sequence_event_summary = ctk.CTkTextbox' in tab_runtime
assert 'self._refresh_sequence_profiles()' in tab_runtime

# 1.7.6 roster export keeps literal Last Online and adds a unified nonblank Last
# Seen activity record. Online members use capture time as confirmed activity;
# offline members use the game's offLineTime.
assert 'Alliance Roster Power + Activity' in responsive_runtime
assert 'alliance-roster-latest.json' in responsive_runtime
assert 'build_roster_export' in responsive_runtime
assert 'al.rank' in roster_export
assert 'al.arena.power' in roster_export
assert 'offLineTime' in roster_export
assert 'totalPower' in roster_export
assert 'arenaPower' in roster_export
assert 'lastOnlineKnown' in roster_export
assert 'lastOnlineAtUtc' in roster_export
assert 'activityStatus' in roster_export
assert 'online_at_capture' in roster_export
assert 'lastSeenEpochMs' in roster_export
assert 'lastSeenAtUtc' in roster_export
assert 'lastSeenBasis' in roster_export
assert 'capture_time_online' in roster_export
assert 'activityComplete' in roster_export
assert 'schemaVersion": 2' in roster_export
assert 'totalPowerRank' in roster_export
assert 'arenaPowerRank' in roster_export

# State Ruler/SVS capture remains armed to carry the same activity evidence.
assert 'BROAD_DISCOVERY_PURPOSES.add(STATE_RULER_PURPOSE)' in responsive_runtime
assert 'state-ruler-activity-context-latest.json' in responsive_runtime
assert 'requiredCommand": "al.rank"' in roster_export
assert 'lastSeenAtUtc' in roster_export
assert 'Full Data Discovery' in discovery_runtime
assert 'discovery-timeline.jsonl' in discovery_runtime
assert 'command-index.json' in discovery_runtime
assert 'field-hints.csv' in discovery_runtime

assert 'capture_all_responses = False' in capture
assert 'set_discovery_capture' in capture
assert 'self.state.discovery_all or is_discovery_command(command)' in capture

# Preserve the 1.7.1 shared discovery-flag fix.
assert agent_parts[0].name == 'part-01.js'
assert 'var captureAllResponses = false;' in agent_prelude
assert 'if (captureAllResponses) return true;' in agent_prelude
assert 'let captureAllResponses' not in agent_source
assert agent_source.count('var captureAllResponses = false;') == 1
assert 'shared captureAllResponses flag' in agent_mode
assert 'setDiscoveryCapture(enabled)' in agent_rpc
assert 'captureAllResponses = !!enabled' in agent_rpc
assert 'return { captureEnabled, captureAllResponses, hookInstalled' in agent_rpc

# Never replace the proven production replay path.
assert 'automationResolveTypedComponent' in resolver
assert 'automation-replay-control-v2' in resolver

print(
    'Verified current roster activity export, workspace power, dedicated tabs, '
    'shared discovery flag, and unchanged typed Duel replay resolver.'
)
