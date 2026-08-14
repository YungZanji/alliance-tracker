from __future__ import annotations

from typing import Any

from app_v172_runtime import App as BaseApp


class App(BaseApp):
    """1.7.3 hotfix: keep responsive Capture Studio vertically scrollable on Windows."""

    SCROLL_INCREMENT = 28

    def __init__(self) -> None:
        self._capture_scroll_canvas: Any | None = None
        super().__init__()
        # Bind on the toplevel (before Tk's global/all bindtag) so wheel events over
        # labels/buttons inside the scrollable Capture page still reach its canvas.
        self.bind("<MouseWheel>", self._capture_mousewheel, add="+")
        self.bind("<Button-4>", self._capture_mousewheel_linux, add="+")
        self.bind("<Button-5>", self._capture_mousewheel_linux, add="+")
        self.after(180, self._install_capture_scroll_hotfix)

    def _apply_responsive_layout(self) -> None:
        super()._apply_responsive_layout()
        # Re-gridding responsive controls changes the requested height of the inner
        # frame. Force the canvas scrollregion to follow that new height every time.
        self.after_idle(self._refresh_capture_scroll_region)

    def _install_capture_scroll_hotfix(self) -> None:
        page = self.pages.get("overview")
        canvas = getattr(page, "_parent_canvas", None) if page is not None else None
        if canvas is None:
            self.after(180, self._install_capture_scroll_hotfix)
            return
        self._capture_scroll_canvas = canvas
        try:
            canvas.configure(yscrollincrement=self.SCROLL_INCREMENT)
        except Exception:
            pass
        self._refresh_capture_scroll_region()

    def _refresh_capture_scroll_region(self) -> None:
        page = self.pages.get("overview")
        canvas = self._capture_scroll_canvas or (getattr(page, "_parent_canvas", None) if page is not None else None)
        if canvas is None:
            return
        self._capture_scroll_canvas = canvas
        try:
            # Preserve the current relative position while recalculating the real
            # content bounds. This also makes the visible scrollbar thumb draggable
            # after a narrow/wide responsive transition.
            current = canvas.yview()
            fraction = float(current[0]) if current else 0.0
            page.update_idletasks()
            canvas.update_idletasks()
            bounds = canvas.bbox("all")
            if bounds:
                canvas.configure(scrollregion=bounds)
                canvas.yview_moveto(max(0.0, min(1.0, fraction)))
        except Exception:
            pass

    def _capture_page_is_visible(self) -> bool:
        page = self.pages.get("overview")
        try:
            return bool(page is not None and page.winfo_ismapped())
        except Exception:
            return False

    def _pointer_inside_capture_canvas(self, event: Any) -> bool:
        canvas = self._capture_scroll_canvas
        if canvas is None or not self._capture_page_is_visible():
            return False
        try:
            x = int(event.x_root)
            y = int(event.y_root)
            left = int(canvas.winfo_rootx())
            top = int(canvas.winfo_rooty())
            right = left + int(canvas.winfo_width())
            bottom = top + int(canvas.winfo_height())
            return left <= x < right and top <= y < bottom
        except Exception:
            return False

    def _capture_mousewheel(self, event: Any) -> str | None:
        canvas = self._capture_scroll_canvas
        if canvas is None or not self._pointer_inside_capture_canvas(event):
            return None
        try:
            delta = int(getattr(event, "delta", 0) or 0)
            if delta == 0:
                return None
            # Windows commonly reports +/-120 per notch; precision touchpads can
            # report smaller values, so always move at least one unit.
            magnitude = max(1, min(4, abs(delta) // 120 or 1))
            direction = -1 if delta > 0 else 1
            canvas.yview_scroll(direction * magnitude, "units")
            return "break"
        except Exception:
            return None

    def _capture_mousewheel_linux(self, event: Any) -> str | None:
        canvas = self._capture_scroll_canvas
        if canvas is None or not self._pointer_inside_capture_canvas(event):
            return None
        try:
            number = int(getattr(event, "num", 0) or 0)
            if number == 4:
                canvas.yview_scroll(-1, "units")
                return "break"
            if number == 5:
                canvas.yview_scroll(1, "units")
                return "break"
        except Exception:
            pass
        return None
