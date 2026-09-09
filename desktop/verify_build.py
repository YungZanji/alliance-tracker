from pathlib import Path

ROOT = Path(__file__).resolve().parent

startup = (ROOT / "startup.py").read_text(encoding="utf-8")
entrypoint = (ROOT / "main.py").read_text(encoding="utf-8")
svs_runtime = (ROOT / "app_svs.py").read_text(encoding="utf-8")
svs_capture = (ROOT / "svs_capture.py").read_text(encoding="utf-8")
glory_runtime = (ROOT / "app_glory.py").read_text(encoding="utf-8")
event_capture_runtime = (ROOT / "app_event_capture.py").read_text(encoding="utf-8")
glory_capture = (ROOT / "glory_war_capture.py").read_text(encoding="utf-8")
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

assert "1.7.0" in startup
assert "from app_v170_runtime import App" in startup
assert "1.7.6" in entrypoint
assert "from app_event_capture import App as CurrentApp" in entrypoint
assert "main.py" in spec

for marker in (
    "⏻  START WORKSPACE",
    "⏻  SHUT DOWN",
    "gameExecutable",
    "subprocess.Popen",
    "Survival.exe",
    "def toggle_workspace_power",
    "MonitorFromWindow",
    "GetMonitorInfoW",
    "SetWindowPos",
    "WM_CLOSE",
    "PostMessageW",
    "TerminateProcess",
    "PROCESS_TERMINATE",
    "_quiet_package_active_capture",
):
    assert marker in power_runtime
assert "self.attach()" not in power_runtime
assert "self._capture_studio_start()" not in power_runtime

assert "return RootApp.page(self, key, title, subtitle)" in tab_runtime
assert "ctk.CTkScrollableFrame(" not in tab_runtime
assert "move only the intended section panel" in tab_fix
assert "return widget.master" in tab_fix
for page_key in ('"polls"', '"roster_export"', '"discovery"', '"sequence_profiles"', '"svs_inspector"'):
    assert page_key in tab_runtime
for marker in (
    "START POLL CAPTURE",
    "SYNC SELECTED POLL",
    "START ROSTER CAPTURE",
    "STOP & EXPORT JSON",
    "START DISCOVERY",
    "ADD MARKER",
    "SAVE CURRENT SEQUENCE",
    "LOAD SELECTED SEQUENCE",
):
    assert marker in tab_runtime

for marker in (
    "al.rank",
    "al.arena.power",
    "offLineTime",
    "totalPower",
    "arenaPower",
    "lastOnlineAtUtc",
    "lastSeenAtUtc",
    "lastSeenBasis",
    "capture_time_online",
    "activityComplete",
):
    assert marker in roster_export
assert "BROAD_DISCOVERY_PURPOSES.add(STATE_RULER_PURPOSE)" in responsive_runtime

for marker in (
    "START SVS CAPTURE",
    "STOP, BUILD & SYNC",
    "BROAD_DISCOVERY_PURPOSES.add(SVS_PURPOSE)",
    "build_roster_export(session_id, SESSIONS_DIR, require_arena=False)",
    'datasets = {"state_ruler_rankings", "state_ruler_attendance"}',
):
    assert marker in svs_runtime
for marker in (
    "SVS Participation + Score Capture",
    "server.battle.user.score.rank",
    "server.battle.score.person.rank",
    '"state_ruler_rankings"',
    '"state_ruler_attendance"',
    'ZoneInfo("America/Vancouver")',
    "time(7, 0)",
    '"leaderboard_score"',
    '"roster_last_seen"',
    '"windowStart"',
    '"windowEnd"',
    '"opponentServerId"',
    '"opponentDetectionConfidence"',
    '"explicit_payload_hint"',
    '"ranking_player_servers"',
):
    assert marker in svs_capture

for marker in (
    "START GLORY WAR CAPTURE",
    "STOP, BUILD & SYNC",
    "BROAD_DISCOVERY_PURPOSES.add(GLORY_WAR_PURPOSE)",
    '"glory_war_rankings"',
    "build_glory_war_snapshot",
    "Opponent player scores archived: no",
):
    assert marker in glory_runtime
for marker in (
    "Glory War Capture",
    "SAVED DISCOVERY IMPORT",
    "IMPORT & SYNC SELECTED",
    "find_glory_war_sessions",
    "Imported saved session",
):
    assert marker in event_capture_runtime
for marker in (
    "Glory War Score Capture",
    "alliance.declare.war.personal.rank",
    'dataset="glory_war_rankings"',
    '"primaryStateScore"',
    '"opponentStateScore"',
    '"opponentAllianceAbbr"',
    '"opponentServerId"',
    '"opponentPlayerRowsStored": False',
    "session_has_glory_war",
    "find_glory_war_sessions",
):
    assert marker in glory_capture

assert "capture_all_responses = False" in capture
assert "set_discovery_capture" in capture
assert "self.state.discovery_all or is_discovery_command(command)" in capture
assert agent_parts[0].name == "part-01.js"
assert "var captureAllResponses = false;" in agent_prelude
assert "if (captureAllResponses) return true;" in agent_prelude
assert "let captureAllResponses" not in agent_source
assert agent_source.count("var captureAllResponses = false;") == 1
assert "shared captureAllResponses flag" in agent_mode
assert "setDiscoveryCapture(enabled)" in agent_rpc
assert "captureAllResponses = !!enabled" in agent_rpc
assert "automationResolveTypedComponent" in resolver
assert "automation-replay-control-v2" in resolver
assert "Full Data Discovery" in discovery_runtime
assert "discovery-timeline.jsonl" in discovery_runtime

print(
    "Verified Glory War live/history capture, SVS opponent/participation capture, roster activity, workspace power, "
    "dedicated tabs, discovery capture, and typed Duel replay."
)
