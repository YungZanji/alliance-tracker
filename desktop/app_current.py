from __future__ import annotations

import ctypes
import os
import queue
import subprocess
import time
from pathlib import Path
from tkinter import messagebox
from typing import Any

import customtkinter as ctk
from ctypes import wintypes

from app import APP_NAME, Colors
from app_v174_runtime_fix import App as BaseApp


TH32CS_SNAPPROCESS = 0x00000002
PROCESS_TERMINATE = 0x0001
WM_CLOSE = 0x0010
SW_RESTORE = 9
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
MONITOR_DEFAULTTONEAREST = 0x00000002
GA_ROOT = 2


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", wintypes.RECT),
        ("rcWork", wintypes.RECT),
        ("dwFlags", wintypes.DWORD),
    ]


def _winapi() -> tuple[Any, Any]:
    """Return 64-bit-safe user32/kernel32 call surfaces for the HWND/HANDLE work below."""
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetAncestor.restype = wintypes.HWND
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.MonitorFromWindow.restype = wintypes.HANDLE
    user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
    user32.GetMonitorInfoW.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL
    return user32, kernel32


class App(BaseApp):
    """1.7.5 current build: global launch/tile/shutdown control for the Last Z workspace."""

    GAME_PROCESS_NAME = "Survival.exe"
    GAME_WINDOW_WAIT_SECONDS = 45.0
    SHUTDOWN_GRACE_SECONDS = 2.5
    TILE_GAP = 6

    def __init__(self) -> None:
        self.workspace_launch_started_at = 0.0
        self.workspace_shutdown_deadline = 0.0
        self.workspace_power_busy = False
        self.workspace_game_hwnd = 0
        super().__init__()
        # 800px prevented an exact half-screen on a 1536px-wide work area. The
        # dedicated 1.7.4 pages no longer need the old giant-canvas minimum.
        self.minsize(700, 520)
        self.after(450, self._refresh_workspace_power_state)

    # ------------------------------------------------------------------
    # Global sidebar power control
    # ------------------------------------------------------------------

    def _rebuild_sidebar(self) -> None:
        super()._rebuild_sidebar()
        if not self.nav:
            return
        side = next(iter(self.nav.values())).master

        existing = getattr(self, "workspace_power_button", None)
        if existing is not None:
            try:
                existing.destroy()
            except Exception:
                pass

        self.workspace_power_button = ctk.CTkButton(
            side,
            text="⏻  START WORKSPACE",
            anchor="w",
            height=36,
            corner_radius=10,
            fg_color=Colors.SUCCESS,
            hover_color="#29B985",
            text_color="#08111F",
            font=(self.font, 10, "bold"),
            command=self.toggle_workspace_power,
        )

        order = [
            "overview",
            "polls",
            "roster_export",
            "discovery",
            "sessions",
            "sequence_studio",
            "sequence_profiles",
            "svs_inspector",
            "replay",
            "duel_auto",
            "cloud",
            "settings",
        ]
        for row in range(1, 32):
            try:
                side.grid_rowconfigure(row, weight=0)
            except Exception:
                pass
        self.workspace_power_button.grid(row=1, column=0, sticky="ew", padx=9, pady=(1, 4))
        visible_row = 2
        for key in order:
            button = self.nav.get(key)
            if key not in self.pages or button is None:
                continue
            button.grid(row=visible_row, column=0, sticky="ew", padx=9, pady=1)
            visible_row += 1
        try:
            side.grid_rowconfigure(visible_row, weight=1)
        except Exception:
            pass

    def toggle_workspace_power(self) -> None:
        if self.workspace_power_busy:
            return
        if self._survival_pids():
            self._shutdown_workspace()
        else:
            self._launch_workspace()

    def _configured_game_executable(self) -> Path | None:
        value = str(self.config.values.get("gameExecutable") or "").strip().strip('"')
        if not value and hasattr(self, "settings_game_path"):
            try:
                value = self.settings_game_path.get().strip().strip('"')
            except Exception:
                value = ""
        if not value:
            return None
        path = Path(os.path.expandvars(value)).expanduser()
        return path if path.is_file() else None

    def _launch_workspace(self) -> None:
        path = self._configured_game_executable()
        if path is None:
            self.show("settings")
            messagebox.showwarning(
                APP_NAME,
                "Choose and save the Last Z launch executable in Settings first.\n\n"
                "The global power button uses that saved path and waits for Survival.exe.",
            )
            return

        self.workspace_power_busy = True
        self.workspace_launch_started_at = time.monotonic()
        self.workspace_game_hwnd = 0
        self._set_power_button("⏻  STARTING LAST Z…", Colors.ACCENT, "#08111F", disabled=True)
        self.write(f"Workspace Power: launching {path.name}.")

        self._tile_workspace(0)
        try:
            subprocess.Popen(
                [str(path)],
                cwd=str(path.parent),
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
        except Exception as exc:
            self.workspace_power_busy = False
            self._set_power_button("⏻  START WORKSPACE", Colors.SUCCESS, "#08111F")
            self.write(f"Workspace Power: game launch failed: {exc}")
            messagebox.showerror(APP_NAME, f"Could not launch Last Z:\n\n{exc}")
            return
        self.after(250, self._wait_for_survival_window)

    def _wait_for_survival_window(self) -> None:
        hwnd = self._largest_survival_window()
        if hwnd:
            self.workspace_game_hwnd = hwnd
            self._tile_workspace(hwnd)
            self.workspace_power_busy = False
            self._set_power_button("⏻  SHUT DOWN", Colors.DANGER, "#F4F7FB")
            self.write("Workspace Power: Last Z is running; Tracker left / game right layout applied.")
            return

        if time.monotonic() - self.workspace_launch_started_at >= self.GAME_WINDOW_WAIT_SECONDS:
            self.workspace_power_busy = False
            if self._survival_pids():
                self._set_power_button("⏻  SHUT DOWN", Colors.DANGER, "#F4F7FB")
                self.write("Workspace Power: Survival.exe started, but no resizable game window was found yet.")
            else:
                self._set_power_button("⏻  START WORKSPACE", Colors.SUCCESS, "#08111F")
                self.write("Workspace Power: timed out waiting for Survival.exe. You can press Power to try again.")
            return
        self.after(250, self._wait_for_survival_window)

    @staticmethod
    def _survival_pids() -> set[int]:
        if os.name != "nt":
            return set()
        _user32, kernel32 = _winapi()
        snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        invalid = ctypes.c_void_p(-1).value
        if snapshot in (0, invalid):
            return set()
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        result: set[int] = set()
        try:
            ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while ok:
                if str(entry.szExeFile).lower() == App.GAME_PROCESS_NAME.lower():
                    result.add(int(entry.th32ProcessID))
                ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            kernel32.CloseHandle(snapshot)
        return result

    def _survival_windows(self) -> list[tuple[int, int]]:
        pids = self._survival_pids()
        if not pids or os.name != "nt":
            return []
        user32, _kernel32 = _winapi()
        windows: list[tuple[int, int]] = []
        enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        @enum_proc
        def callback(hwnd: int, _lparam: int) -> bool:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if int(pid.value) not in pids or not user32.IsWindowVisible(hwnd):
                return True
            rect = wintypes.RECT()
            if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                return True
            width = max(0, int(rect.right - rect.left))
            height = max(0, int(rect.bottom - rect.top))
            area = width * height
            if area > 20_000:
                windows.append((int(hwnd), area))
            return True

        user32.EnumWindows(callback, 0)
        windows.sort(key=lambda row: row[1], reverse=True)
        return windows

    def _largest_survival_window(self) -> int:
        windows = self._survival_windows()
        return int(windows[0][0]) if windows else 0

    def _tracker_hwnd(self) -> int:
        if os.name != "nt":
            return 0
        try:
            user32, _kernel32 = _winapi()
            self.update_idletasks()
            inner = int(self.winfo_id())
            return int(user32.GetAncestor(inner, GA_ROOT) or inner)
        except Exception:
            return 0

    @staticmethod
    def _monitor_work_area(hwnd: int) -> tuple[int, int, int, int] | None:
        if os.name != "nt" or not hwnd:
            return None
        user32, _kernel32 = _winapi()
        monitor = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
        if not monitor:
            return None
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        if not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
            return None
        work = info.rcWork
        return int(work.left), int(work.top), int(work.right - work.left), int(work.bottom - work.top)

    def _tile_workspace(self, game_hwnd: int) -> None:
        if os.name != "nt":
            return
        tracker_hwnd = self._tracker_hwnd()
        area = self._monitor_work_area(tracker_hwnd)
        if not tracker_hwnd or area is None:
            return
        left, top, width, height = area
        gap = max(0, int(self.TILE_GAP))
        left_width = max(1, (width - gap) // 2)
        right_x = left + left_width + gap
        right_width = max(1, width - left_width - gap)
        user32, _kernel32 = _winapi()
        flags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
        try:
            user32.ShowWindow(tracker_hwnd, SW_RESTORE)
            user32.SetWindowPos(tracker_hwnd, 0, left, top, left_width, height, flags)
            if game_hwnd:
                user32.ShowWindow(game_hwnd, SW_RESTORE)
                user32.SetWindowPos(game_hwnd, 0, right_x, top, right_width, height, flags)
        except Exception as exc:
            self.write(f"Workspace Power: window tiling could not be applied: {exc}")

    def _shutdown_workspace(self) -> None:
        self.workspace_power_busy = True
        self._set_power_button("⏻  SHUTTING DOWN…", Colors.DANGER, "#F4F7FB", disabled=True)
        self.write("Workspace Power: shutting down Last Z and Alliance Tracker.")
        self._quiet_package_active_capture()

        if os.name == "nt":
            user32, _kernel32 = _winapi()
            for hwnd, _area in self._survival_windows():
                try:
                    user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
                except Exception:
                    pass
        self.workspace_shutdown_deadline = time.monotonic() + self.SHUTDOWN_GRACE_SECONDS
        self.after(120, self._wait_for_game_shutdown)

    def _quiet_package_active_capture(self) -> None:
        if not self.session_id:
            return
        session_id = str(self.session_id)
        try:
            self.capture.stop()
            while True:
                try:
                    event = self.capture.events.get_nowait()
                except queue.Empty:
                    break
                self.handle(event.kind, event.payload)
            self.store.stop_session(session_id)
            package = self.store.package(session_id)
            self.write(f"Workspace Power: active capture packaged before shutdown: {package.name}")
        except Exception as exc:
            self.write(f"Workspace Power: capture shutdown warning: {exc}")
        finally:
            self.session_id = None
            try:
                self.stop_button.configure(state="disabled")
                self.start_button.configure(state="normal")
            except Exception:
                pass
            try:
                self.recording.set("Stopped", "Workspace shutting down")
            except Exception:
                pass

    def _wait_for_game_shutdown(self) -> None:
        pids = self._survival_pids()
        if not pids:
            self._finish_workspace_shutdown()
            return
        if time.monotonic() < self.workspace_shutdown_deadline:
            self.after(120, self._wait_for_game_shutdown)
            return

        if os.name == "nt":
            _user32, kernel32 = _winapi()
            for pid in pids:
                handle = kernel32.OpenProcess(PROCESS_TERMINATE, False, int(pid))
                if not handle:
                    continue
                try:
                    kernel32.TerminateProcess(handle, 0)
                finally:
                    kernel32.CloseHandle(handle)
        self.after(180, self._finish_workspace_shutdown)

    def _finish_workspace_shutdown(self) -> None:
        try:
            self.capture.detach()
        except Exception:
            pass
        self.destroy()

    def _refresh_workspace_power_state(self) -> None:
        if self.workspace_power_busy:
            try:
                self.after(900, self._refresh_workspace_power_state)
            except Exception:
                pass
            return
        if self._survival_pids():
            self._set_power_button("⏻  SHUT DOWN", Colors.DANGER, "#F4F7FB")
        else:
            self._set_power_button("⏻  START WORKSPACE", Colors.SUCCESS, "#08111F")
        try:
            self.after(1500, self._refresh_workspace_power_state)
        except Exception:
            pass

    def _set_power_button(self, text: str, color: Any, text_color: Any, disabled: bool = False) -> None:
        button = getattr(self, "workspace_power_button", None)
        if button is None:
            return
        try:
            button.configure(
                text=text,
                fg_color=color,
                text_color=text_color,
                state="disabled" if disabled else "normal",
            )
        except Exception:
            pass
