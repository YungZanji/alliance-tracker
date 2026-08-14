// Discovery commands that must be decoded by the Frida response hook.
// capture.py has a matching desktop-side allowlist, but DispatchResponse calls
// shouldCaptureCommand() before the payload ever reaches Python. Keep these
// additions in the agent itself so discovery captures can persist snapshots.
TARGET_COMMANDS.add('get.alliance.vote');
TARGET_COMMANDS.add('get.alliance.notice');
