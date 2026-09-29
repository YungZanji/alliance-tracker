from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENT = (ROOT / "desktop" / "agent" / "part06_direct_duel.js").read_text(encoding="utf-8")
RUNTIME = (ROOT / "desktop" / "app_direct_duel_v178.py").read_text(encoding="utf-8")


def test_direct_duel_uses_proven_main_thread_pump() -> None:
    assert "directDuelOriginalProcessReplayQueue = automationProcessReplayQueue" in AGENT
    assert "directDuelProcessQueue();" in AGENT
    assert "XLuaManager.SafeDoString" in AGENT
    assert "Resources.FindObjectsOfTypeAll" in AGENT
    assert "function installDirectDuelHook" not in AGENT
    assert "forMethodPointers(method, 'DirectDuel.XLuaManager.Update'" not in AGENT


def test_direct_duel_remains_read_only_whitelisted() -> None:
    assert "get.alliance.duel.season.info" in AGENT
    assert "get.alliance.duel.group.info" in AGENT
    assert "al.battle.week.result.info" in AGENT
    assert "al.battle.rank.info" in AGENT
    assert "SFSNetwork.SendMessage" in AGENT
    assert "queueDirectDuelProbe" in AGENT


def test_direct_duel_packages_diagnostics() -> None:
    assert "direct-duel-diagnostics.jsonl" in RUNTIME
    assert "get_direct_duel_status" in RUNTIME
    assert "direct-duel-status" in RUNTIME
