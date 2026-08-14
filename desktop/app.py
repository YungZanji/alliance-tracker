from __future__ import annotations

import os
import queue
import threading
from pathlib import Path
from tkinter import font as tkfont, messagebox, ttk
from typing import Any

import customtkinter as ctk

from capture import CaptureController, decode_response
from cloud import CloudClient, Config
from storage import Store
from utils import APP_DATA_DIR, SESSIONS_DIR, log

APP_NAME, APP_VERSION = "Alliance Tracker", "0.5.1"
CLOUDFLARE_ENDPOINT = "https://wdz.state305.cc/api/sync"
ROOT = Path(__file__).resolve().parent
ctk.set_default_color_theme("blue")


class Colors:
    BG = ("#F4F7FB", "#08111F")
    PANEL = ("#FFFFFF", "#101B2C")
    PANEL2 = ("#EEF3F8", "#162338")
    BORDER = ("#D8E1EC", "#26364E")
    TEXT = ("#101B2C", "#F4F7FB")
    MUTED = ("#63758D", "#93A4BB")
    ACCENT, ACCENT_HOVER = "#39B5FF", "#1796DA"
    SUCCESS, DANGER = "#35D29A", "#FF6577"


class Card(ctk.CTkFrame):
    def __init__(self, master: Any, font: str, title: str, value: str, detail: str) -> None:
        super().__init__(master, fg_color=Colors.PANEL, corner_radius=14, border_width=1, border_color=Colors.BORDER)
        ctk.CTkLabel(self, text=title, text_color=Colors.MUTED, font=(font, 11)).pack(anchor="w", padx=15, pady=(13, 1))
        self.value = ctk.CTkLabel(self, text=value, text_color=Colors.TEXT, font=(font, 23, "bold"))
        self.value.pack(anchor="w", padx=15)
        self.detail = ctk.CTkLabel(self, text=detail, text_color=Colors.MUTED, font=(font, 10))
        self.detail.pack(anchor="w", padx=15, pady=(1, 13))

    def set(self, value: str, detail: str = "") -> None:
        self.value.configure(text=value)
        self.detail.configure(text=detail)


class App(ctk.CTk):
    def __init__(self) -> None:
        super().__init__(fg_color=Colors.BG)
        self.title(f"{APP_NAME} {APP_VERSION}")
        self.geometry("1160x750")
        self.minsize(980, 650)
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.font = self._font()
        self.config = Config()
        ctk.set_appearance_mode(self.config.values["theme"])
        self.store = Store()
        self.capture = CaptureController(ROOT / "agent")
        self.session_id: str | None = None
        self.responses = 0
        self.snapshots = 0
        self.pages: dict[str, ctk.CTkFrame] = {}
        self.nav: dict[str, ctk.CTkButton] = {}
        self._layout()
        self.show("overview")
        self.after(100, self._events)
        self.refresh_sessions()
        self.write("Ready. Open Last Z, enter the city, then attach the capture engine.")

    def _font(self) -> str:
        families = {name.lower(): name for name in tkfont.families(self)}
        for candidate in ("Google Sans", "Google Sans Text", "Segoe UI Variable", "Segoe UI"):
            if candidate.lower() in families:
                return families[candidate.lower()]
        return "Arial"

    def _layout(self) -> None:
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)
        side = ctk.CTkFrame(self, width=220, corner_radius=0, fg_color=("#FFFFFF", "#07101D"))
        side.grid(row=0, column=0, sticky="nsew")
        side.grid_propagate(False)
        side.grid_rowconfigure(8, weight=1)
        brand = ctk.CTkFrame(side, fg_color="transparent")
        brand.grid(row=0, column=0, sticky="ew", padx=18, pady=(22, 24))
        ctk.CTkLabel(brand, text="ALLIANCE", text_color=Colors.ACCENT, font=(self.font, 11, "bold")).pack(anchor="w")
        ctk.CTkLabel(brand, text="Tracker", text_color=Colors.TEXT, font=(self.font, 27, "bold")).pack(anchor="w")
        ctk.CTkLabel(brand, text="Last Z capture console", text_color=Colors.MUTED, font=(self.font, 10)).pack(anchor="w")
        for row, (key, label) in enumerate((("overview", "Overview"), ("capture", "Capture"), ("sessions", "Sessions"), ("cloud", "Cloud Sync"), ("settings", "Settings")), 1):
            button = ctk.CTkButton(side, text=label, anchor="w", height=43, corner_radius=10, fg_color="transparent", hover_color=Colors.PANEL2, text_color=Colors.MUTED, font=(self.font, 13, "bold"), command=lambda k=key: self.show(k))
            button.grid(row=row, column=0, sticky="ew", padx=11, pady=3)
            self.nav[key] = button
        note = ctk.CTkFrame(side, fg_color=Colors.PANEL, corner_radius=12, border_width=1, border_color=Colors.BORDER)
        note.grid(row=9, column=0, sticky="sew", padx=13, pady=13)
        ctk.CTkLabel(note, text="Manual navigation", text_color=Colors.SUCCESS, font=(self.font, 11, "bold")).pack(anchor="w", padx=11, pady=(11, 2))
        ctk.CTkLabel(note, text="No game clicks or requests are sent by the app.", text_color=Colors.MUTED, wraplength=170, justify="left", font=(self.font, 9)).pack(anchor="w", padx=11, pady=(0, 11))
        self.content = ctk.CTkFrame(self, fg_color="transparent")
        self.content.grid(row=0, column=1, sticky="nsew")
        self.content.grid_rowconfigure(0, weight=1)
        self.content.grid_columnconfigure(0, weight=1)
        self._overview()
        self._capture()
        self._sessions()
        self._cloud()
        self._settings()

    def page(self, key: str, title: str, subtitle: str) -> ctk.CTkFrame:
        frame = ctk.CTkFrame(self.content, fg_color="transparent")
        frame.grid(row=0, column=0, sticky="nsew", padx=25, pady=21)
        frame.grid_remove()
        self.pages[key] = frame
        ctk.CTkLabel(frame, text=title, text_color=Colors.TEXT, font=(self.font, 28, "bold")).pack(anchor="w")
        ctk.CTkLabel(frame, text=subtitle, text_color=Colors.MUTED, font=(self.font, 12), wraplength=850, justify="left").pack(anchor="w", pady=(2, 17))
        return frame

    def _overview(self) -> None:
        page = self.page("overview", "Capture overview", "A local-first console for Alliance Duel now, with room for additional metric profiles later.")
        cards = ctk.CTkFrame(page, fg_color="transparent")
        cards.pack(fill="x")
        for i in range(4):
            cards.grid_columnconfigure(i, weight=1)
        self.game = Card(cards, self.font, "Game", "Not attached", "Survival.exe")
        self.game.grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self.recording = Card(cards, self.font, "Capture", "Stopped", "No active session")
        self.recording.grid(row=0, column=1, sticky="ew", padx=6)
        self.count = Card(cards, self.font, "Snapshots", "0", "Current session")
        self.count.grid(row=0, column=2, sticky="ew", padx=6)
        cloud_state = "Configured" if self.config.values["cloudEndpoint"] and self.config.values["uploadToken"] else "Not configured"
        self.cloud_card = Card(cards, self.font, "Cloud", cloud_state, "Local capture works now")
        self.cloud_card.grid(row=0, column=3, sticky="ew", padx=(6, 0))
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x", pady=17)
        ctk.CTkLabel(panel, text="Alliance Duel workflow", text_color=Colors.TEXT, font=(self.font, 17, "bold")).pack(anchor="w", padx=17, pady=(16, 3))
        ctk.CTkLabel(panel, text="Attach once, start a session, then manually open current-day, weekly, My Alliance, history and week-summary views.", text_color=Colors.MUTED, font=(self.font, 11), wraplength=820, justify="left").pack(anchor="w", padx=17)
        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=17, pady=16)
        self.attach_overview = ctk.CTkButton(row, text="Attach to Last Z", height=41, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 12, "bold"), command=self.attach)
        self.attach_overview.pack(side="left")
        ctk.CTkButton(row, text="Open Capture Workspace", height=41, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, font=(self.font, 12, "bold"), command=lambda: self.show("capture")).pack(side="left", padx=8)
        self.overview_log = ctk.CTkTextbox(page, fg_color=Colors.PANEL, text_color=Colors.MUTED, border_width=1, border_color=Colors.BORDER, corner_radius=14, font=("Consolas", 10))
        self.overview_log.pack(fill="both", expand=True)
        self.overview_log.configure(state="disabled")

    def _capture(self) -> None:
        page = self.page("capture", "Capture workspace", "You control the game. Alliance Tracker records the decoded responses produced by the screens you open.")
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")
        ctk.CTkLabel(panel, text="Session label", text_color=Colors.MUTED, font=(self.font, 11)).pack(anchor="w", padx=17, pady=(15, 3))
        self.label = ctk.CTkEntry(panel, height=39, placeholder_text="Example: WDZ Alliance Duel - Week 4", fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 11))
        self.label.pack(fill="x", padx=17)
        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=17, pady=15)
        self.attach_button = ctk.CTkButton(row, text="1  Attach", height=41, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, font=(self.font, 12, "bold"), command=self.attach)
        self.attach_button.pack(side="left")
        self.start_button = ctk.CTkButton(row, text="2  Start Capture", height=41, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 12, "bold"), state="disabled", command=self.start)
        self.start_button.pack(side="left", padx=8)
        self.stop_button = ctk.CTkButton(row, text="Stop & Package", height=41, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 12, "bold"), state="disabled", command=self.stop)
        self.stop_button.pack(side="left")
        ctk.CTkButton(row, text="Open Data Folder", height=41, fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, font=(self.font, 11, "bold"), command=lambda: os.startfile(APP_DATA_DIR)).pack(side="right")
        body = ctk.CTkFrame(page, fg_color="transparent")
        body.pack(fill="both", expand=True, pady=15)
        body.grid_columnconfigure((0, 1), weight=1)
        body.grid_rowconfigure(0, weight=1)
        checklist = ctk.CTkFrame(body, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        checklist.grid(row=0, column=0, sticky="nsew", padx=(0, 7))
        ctk.CTkLabel(checklist, text="Alliance Duel checklist", text_color=Colors.TEXT, font=(self.font, 15, "bold")).pack(anchor="w", padx=17, pady=(15, 7))
        self.checks = []
        for text in ("Open Alliance Duel", "Open current-day Personal Ranking", "Open weekly ranking", "Enable My Alliance", "Open completed-day/history views", "Open weekly result summary"):
            var = ctk.BooleanVar(master=self, value=False)
            self.checks.append(var)
            ctk.CTkCheckBox(checklist, text=text, variable=var, text_color=Colors.MUTED, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, border_color=Colors.BORDER, font=(self.font, 11)).pack(anchor="w", padx=17, pady=5)
        ctk.CTkLabel(checklist, text="Changing a tab or reopening the ranking forces a fresh normal game response.", text_color=Colors.MUTED, font=(self.font, 9), wraplength=380, justify="left").pack(anchor="w", padx=17, pady=(11, 14))
        log_panel = ctk.CTkFrame(body, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        log_panel.grid(row=0, column=1, sticky="nsew", padx=(7, 0))
        ctk.CTkLabel(log_panel, text="Live capture log", text_color=Colors.TEXT, font=(self.font, 15, "bold")).pack(anchor="w", padx=17, pady=(15, 7))
        self.capture_log = ctk.CTkTextbox(log_panel, fg_color=Colors.PANEL2, text_color=Colors.MUTED, corner_radius=10, font=("Consolas", 10))
        self.capture_log.pack(fill="both", expand=True, padx=17, pady=(0, 17))
        self.capture_log.configure(state="disabled")

    def _sessions(self) -> None:
        page = self.page("sessions", "Capture sessions", "Each run is kept as raw JSON, normalized JSON, CSV exports and a packageable ZIP.")
        row = ctk.CTkFrame(page, fg_color="transparent")
        row.pack(fill="x", pady=(0, 9))
        ctk.CTkButton(row, text="Refresh", fg_color=Colors.PANEL2, hover_color=Colors.BORDER, font=(self.font, 11, "bold"), command=self.refresh_sessions).pack(side="left")
        ctk.CTkButton(row, text="Open Sessions Folder", fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, font=(self.font, 11, "bold"), command=lambda: os.startfile(SESSIONS_DIR)).pack(side="left", padx=7)
        frame = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        frame.pack(fill="both", expand=True)
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Tracker.Treeview", background="#162338", fieldbackground="#162338", foreground="#F4F7FB", rowheight=31, borderwidth=0, font=(self.font, 10))
        style.configure("Tracker.Treeview.Heading", background="#101B2C", foreground="#93A4BB", relief="flat", font=(self.font, 10, "bold"))
        style.map("Tracker.Treeview", background=[("selected", "#1796DA")])
        columns = ("label", "started", "responses", "snapshots")
        self.tree = ttk.Treeview(frame, columns=columns, show="headings", style="Tracker.Treeview")
        for key, title, width in (("label", "Session", 420), ("started", "Started", 190), ("responses", "Responses", 110), ("snapshots", "Snapshots", 110)):
            self.tree.heading(key, text=title)
            self.tree.column(key, width=width, anchor="w")
        self.tree.pack(fill="both", expand=True, padx=15, pady=15)
        self.tree.bind("<Double-1>", self.open_session)

    def _cloud(self) -> None:
        page = self.page("cloud", "Cloud sync", "Send captures to Cloudflare or another compatible Alliance Tracker endpoint. Settings are stored locally by the app.")
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")
        ctk.CTkLabel(panel, text="Cloud sync endpoint", text_color=Colors.MUTED, font=(self.font, 11)).pack(anchor="w", padx=17, pady=(15, 3))
        self.endpoint = ctk.CTkEntry(panel, height=39, fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 10))
        self.endpoint.pack(fill="x", padx=17)
        self.endpoint.insert(0, self.config.values["cloudEndpoint"])
        ctk.CTkLabel(panel, text="Upload token", text_color=Colors.MUTED, font=(self.font, 11)).pack(anchor="w", padx=17, pady=(12, 3))
        self.token = ctk.CTkEntry(panel, height=39, show="•", fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 10))
        self.token.pack(fill="x", padx=17)
        self.token.insert(0, self.config.values["uploadToken"])
        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=17, pady=(16, 7))
        ctk.CTkButton(row, text="Save Connection", fg_color=Colors.PANEL2, hover_color=Colors.BORDER, font=(self.font, 11, "bold"), command=self.save_cloud).pack(side="left")
        ctk.CTkButton(row, text="Use WDZ Cloudflare", fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, font=(self.font, 11, "bold"), command=self.use_cloudflare).pack(side="left", padx=7)
        row2 = ctk.CTkFrame(panel, fg_color="transparent")
        row2.pack(fill="x", padx=17, pady=(0, 16))
        self.sync_latest_button = ctk.CTkButton(row2, text="Sync Latest Capture", fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 11, "bold"), command=self.sync_latest)
        self.sync_latest_button.pack(side="left")
        self.sync_button = ctk.CTkButton(row2, text="Sync Pending", fg_color=Colors.PANEL2, hover_color=Colors.BORDER, font=(self.font, 11, "bold"), command=self.sync_pending)
        self.sync_button.pack(side="left", padx=7)
        ctk.CTkLabel(panel, text="Sync Latest Capture can safely resend a session that was already sent to Google. The cloud backend deduplicates source snapshots.", text_color=Colors.MUTED, font=(self.font, 9), wraplength=780, justify="left").pack(anchor="w", padx=17, pady=(0, 15))
        self.cloud_status = ctk.CTkLabel(page, text="Connection has not been tested.", text_color=Colors.MUTED, font=(self.font, 11), wraplength=850, justify="left")
        self.cloud_status.pack(anchor="w", pady=12)

    def _settings(self) -> None:
        page = self.page("settings", "Settings", "Change the settings you need directly in Alliance Tracker. No JSON editing is required.")
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")
        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=17, pady=(17, 9))
        ctk.CTkLabel(row, text="Appearance", text_color=Colors.TEXT, font=(self.font, 13, "bold")).pack(side="left")
        self.theme = ctk.CTkSwitch(row, text="Dark mode", text_color=Colors.MUTED, font=(self.font, 11), command=self.toggle)
        self.theme.pack(side="right")
        if self.config.values["theme"] == "dark":
            self.theme.select()

        scale_row = ctk.CTkFrame(panel, fg_color="transparent")
        scale_row.pack(fill="x", padx=17, pady=9)
        ctk.CTkLabel(scale_row, text="Interface scale", text_color=Colors.MUTED, font=(self.font, 11)).pack(side="left")
        self.scale_menu = ctk.CTkOptionMenu(
            scale_row,
            values=["100%", "110%", "120%", "132%", "140%", "150%", "160%"],
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 11),
            command=self.set_scale,
        )
        self.scale_menu.pack(side="right")
        current_scale = float(self.config.values.get("uiScale", 1.32))
        self.scale_menu.set(f"{int(round(current_scale * 100))}%")

        data_row = ctk.CTkFrame(panel, fg_color="transparent")
        data_row.pack(fill="x", padx=17, pady=(9, 17))
        ctk.CTkLabel(data_row, text=f"Local data: {APP_DATA_DIR}\nSelected font: {self.font}", text_color=Colors.MUTED, font=(self.font, 10), justify="left").pack(side="left")
        ctk.CTkButton(data_row, text="Open Local Data", fg_color=Colors.PANEL2, hover_color=Colors.BORDER, font=(self.font, 10, "bold"), command=lambda: os.startfile(APP_DATA_DIR)).pack(side="right")
        self.settings_status = ctk.CTkLabel(page, text="Theme, scale, cloud endpoint and token are saved locally by the app.", text_color=Colors.MUTED, font=(self.font, 10))
        self.settings_status.pack(anchor="w", pady=12)

    def show(self, key: str) -> None:
        for name, page in self.pages.items():
            page.grid_remove()
            self.nav[name].configure(fg_color="transparent", text_color=Colors.MUTED)
        self.pages[key].grid()
        self.nav[key].configure(fg_color=Colors.PANEL2, text_color=Colors.TEXT)

    def write(self, text: str) -> None:
        log(text)
        for box in (getattr(self, "overview_log", None), getattr(self, "capture_log", None)):
            if box:
                box.configure(state="normal")
                box.insert("end", text + "\n")
                box.see("end")
                box.configure(state="disabled")

    def attach(self) -> None:
        self.write("Attaching to Survival.exe...")
        self.attach_button.configure(state="disabled")
        self.attach_overview.configure(state="disabled")

        def work() -> None:
            try:
                self.capture.attach()
            except Exception as exc:
                self.after(0, lambda msg=str(exc): self._error(msg))

        threading.Thread(target=work, daemon=True).start()

    def _error(self, message: str) -> None:
        self.attach_button.configure(state="normal")
        self.attach_overview.configure(state="normal")
        self.write("Error: " + message)
        messagebox.showerror(APP_NAME, message)

    def start(self) -> None:
        if self.session_id:
            return
        label = self.label.get().strip() or "Alliance Duel"
        try:
            self.session_id = self.store.start_session(label)
            self.capture.start()
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))
            self.session_id = None
            return
        self.responses = self.snapshots = 0
        for var in self.checks:
            var.set(False)
        self.start_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.recording.set("Recording", label)
        self.count.set("0", "Current session")
        self.write("Capture started: " + self.session_id)

    def stop(self) -> None:
        if not self.session_id:
            return
        session_id = self.session_id
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
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))
            return
        self.session_id = None
        self.stop_button.configure(state="disabled")
        self.start_button.configure(state="normal")
        self.recording.set("Stopped", "Package ready")
        self.write("Capture package: " + package.name)
        self.refresh_sessions()
        messagebox.showinfo(APP_NAME, f"Capture complete.\n\nResponses: {self.responses}\nSnapshots: {self.snapshots}\n\n{package}")

    def _events(self) -> None:
        try:
            while True:
                event = self.capture.events.get_nowait()
                self.handle(event.kind, event.payload)
        except queue.Empty:
            pass
        self.after(100, self._events)

    def handle(self, kind: str, payload: Any) -> None:
        if kind == "attached":
            self.game.set("Attached", f"PID {payload.get('pid')}")
            self.write("Attached. Waiting for capture engine...")
        elif kind == "hook-ready":
            self.start_button.configure(state="normal")
            self.attach_button.configure(text="Attached", state="disabled")
            self.attach_overview.configure(text="Attached", state="disabled")
            self.write(f"Capture engine ready. {len(payload.get('hooks') or [])} hook addresses installed.")
        elif kind == "detached":
            self.game.set("Disconnected", payload.get("reason") or "Detached")
            self.start_button.configure(state="disabled")
            self.write("Game detached: " + str(payload.get("reason")))
        elif kind == "agent-error":
            self.write("Agent error: " + str(payload.get("description") or payload))
        elif kind == "diagnostic" and payload.get("level") == "error":
            self.write("Capture engine: " + str(payload.get("message")))
        elif kind == "dispatch-response" and self.session_id and payload.get("command") in {"al.battle.rank.info", "al.battle.week.result.info", "get.alliance.duel.season.info"}:
            self.write("Observed " + str(payload.get("command")))
        elif kind == "response" and self.session_id:
            try:
                command, sequence, captured, decoded = decode_response(payload)
                inserted, saved = self.store.save_response(self.session_id, sequence, command, captured, decoded)
            except Exception as exc:
                self.write("Could not process response: " + str(exc))
                return
            if inserted:
                self.responses += 1
                self.snapshots += saved
                self.count.set(str(self.snapshots), f"{self.responses} responses")
                self.write(f"Saved {command}: {saved} snapshot(s)")
            else:
                self.write("Duplicate ignored: " + command)

    def refresh_sessions(self) -> None:
        if not hasattr(self, "tree"):
            return
        for item in self.tree.get_children():
            self.tree.delete(item)
        for session in self.store.list_sessions():
            self.tree.insert("", "end", iid=session["id"], values=(session["label"], str(session["started_at"]).replace("T", " ")[:19], session["response_count"], session["snapshot_count"]))

    def open_session(self, _event: Any = None) -> None:
        selection = self.tree.selection()
        if selection and (SESSIONS_DIR / selection[0]).exists():
            os.startfile(SESSIONS_DIR / selection[0])

    def save_cloud(self) -> None:
        self.config.values["cloudEndpoint"] = self.endpoint.get().strip()
        self.config.values["uploadToken"] = self.token.get().strip()
        self.config.save()
        self.cloud_status.configure(text="Connection saved locally.", text_color=Colors.MUTED)

    def use_cloudflare(self) -> None:
        self.endpoint.delete(0, "end")
        self.endpoint.insert(0, CLOUDFLARE_ENDPOINT)
        self.save_cloud()
        self.cloud_status.configure(text=f"Cloudflare endpoint selected: {CLOUDFLARE_ENDPOINT}", text_color=Colors.SUCCESS)

    def _begin_sync(self, snapshots: list[dict[str, Any]], detail: str) -> None:
        if not snapshots:
            self.cloud_status.configure(text="There are no snapshots to upload.", text_color=Colors.MUTED)
            return
        self.save_cloud()
        self.sync_latest_button.configure(state="disabled")
        self.sync_button.configure(state="disabled")
        self.cloud_status.configure(text=f"Uploading {len(snapshots)} snapshots {detail}...", text_color=Colors.MUTED)

        def work() -> None:
            try:
                result = CloudClient(self.config.values["cloudEndpoint"], self.config.values["uploadToken"]).upload(snapshots)
                ids = result.get("acceptedSnapshotIds") or [row["id"] for row in snapshots]
                self.store.mark_synced(int(value) for value in ids)
                accepted = int(result.get("accepted", len(ids)))
                duplicates = int(result.get("duplicates", 0))
                self.after(0, lambda: self._sync_done(len(ids), accepted, duplicates))
            except Exception as exc:
                self.after(0, lambda msg=str(exc): self._sync_failed(msg))

        threading.Thread(target=work, daemon=True).start()

    def sync_latest(self) -> None:
        session_id, snapshots = self.store.latest_session_snapshots()
        if not session_id:
            self.cloud_status.configure(text="No completed capture session was found.", text_color=Colors.MUTED)
            return
        self._begin_sync(snapshots, f"from {session_id}")

    def sync_pending(self) -> None:
        snapshots = self.store.unsynced()
        if not snapshots:
            self.cloud_status.configure(text="Nothing is waiting to sync.", text_color=Colors.MUTED)
            return
        self._begin_sync(snapshots, "that are marked pending")

    def _sync_done(self, count: int, accepted: int, duplicates: int) -> None:
        self.sync_latest_button.configure(state="normal")
        self.sync_button.configure(state="normal")
        self.cloud_status.configure(
            text=f"Cloud sync complete. Acknowledged {count} snapshots; {accepted} new, {duplicates} already present.",
            text_color=Colors.SUCCESS,
        )
        self.cloud_card.set("Connected", "Latest upload succeeded")

    def _sync_failed(self, message: str) -> None:
        self.sync_latest_button.configure(state="normal")
        self.sync_button.configure(state="normal")
        self.cloud_status.configure(text=message, text_color=Colors.DANGER)

    def toggle(self) -> None:
        self.config.values["theme"] = "dark" if self.theme.get() else "light"
        ctk.set_appearance_mode(self.config.values["theme"])
        self.config.save()

    def set_scale(self, value: str) -> None:
        try:
            scale = float(value.rstrip("%")) / 100.0
        except ValueError:
            return
        scale = max(1.0, min(1.6, scale))
        self.config.values["uiScale"] = scale
        self.config.values["uiScaleVersion"] = 2
        self.config.save()
        ctk.set_widget_scaling(scale)
        style = ttk.Style(self)
        style.configure("Tracker.Treeview", font=(self.font, max(15, round(12 * scale))), rowheight=max(44, round(35 * scale)))
        style.configure("Tracker.Treeview.Heading", font=(self.font, max(13, round(11 * scale)), "bold"))
        self.settings_status.configure(text=f"Interface scale saved at {scale:.0%}.", text_color=Colors.SUCCESS)

    def close(self) -> None:
        if self.session_id and not messagebox.askyesno(APP_NAME, "A capture is active. Stop it and exit?"):
            return
        try:
            if self.session_id:
                self.capture.stop()
                self.store.stop_session(self.session_id)
        except Exception:
            pass
        self.capture.detach()
        self.destroy()


if __name__ == "__main__":
    App().mainloop()
