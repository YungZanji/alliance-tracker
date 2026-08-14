from __future__ import annotations

import csv
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any, Iterable

from normalizers import AllianceDuelNormalizer, Snapshot
from utils import DB_PATH, SESSIONS_DIR, json_compact, json_hash, local_stamp, safe_slug, utc_now


class Store:
    def __init__(self, path: Path = DB_PATH) -> None:
        self.path = path
        self._init()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def _init(self) -> None:
        with self._connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions(
              id TEXT PRIMARY KEY,label TEXT NOT NULL,started_at TEXT NOT NULL,stopped_at TEXT,
              response_count INTEGER NOT NULL DEFAULT 0,snapshot_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS responses(
              id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,sequence INTEGER,
              command TEXT NOT NULL,captured_at TEXT NOT NULL,payload_json TEXT NOT NULL,
              payload_hash TEXT NOT NULL,UNIQUE(session_id,command,payload_hash),
              FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS snapshots(
              id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,dataset TEXT NOT NULL,
              command TEXT NOT NULL,captured_at TEXT NOT NULL,context_json TEXT NOT NULL,
              rows_json TEXT NOT NULL,sequence INTEGER,source_hash TEXT NOT NULL,synced_at TEXT,
              UNIQUE(session_id,dataset,source_hash),FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_snapshot_session ON snapshots(session_id,dataset);
            """)

    def start_session(self, label: str) -> str:
        session_id = f"{local_stamp()}_{safe_slug(label)}"
        with self._connect() as db:
            db.execute(
                "INSERT INTO sessions(id,label,started_at) VALUES(?,?,?)",
                (session_id, label, utc_now()),
            )
        for folder in ("raw", "normalized", "exports"):
            (SESSIONS_DIR / session_id / folder).mkdir(parents=True, exist_ok=True)
        return session_id

    def stop_session(self, session_id: str) -> None:
        with self._connect() as db:
            counts = db.execute(
                "SELECT "
                "(SELECT COUNT(*) FROM responses WHERE session_id=?) responses,"
                "(SELECT COUNT(*) FROM snapshots WHERE session_id=?) snapshots",
                (session_id, session_id),
            ).fetchone()
            db.execute(
                "UPDATE sessions SET stopped_at=?,response_count=?,snapshot_count=? WHERE id=?",
                (utc_now(), counts["responses"], counts["snapshots"], session_id),
            )
        self.write_manifest(session_id)

    def save_response(
        self,
        session_id: str,
        sequence: int | None,
        command: str,
        captured_at: str,
        payload: Any,
    ) -> tuple[bool, int]:
        payload_hash = json_hash(payload)
        snapshots = AllianceDuelNormalizer.normalize(command, payload, captured_at, sequence)
        saved = 0
        with self._connect() as db:
            cursor = db.execute(
                "INSERT OR IGNORE INTO responses"
                "(session_id,sequence,command,captured_at,payload_json,payload_hash) "
                "VALUES(?,?,?,?,?,?)",
                (
                    session_id,
                    sequence,
                    command,
                    captured_at,
                    json_compact(payload),
                    payload_hash,
                ),
            )
            if not cursor.rowcount:
                return False, 0
            for snapshot in snapshots:
                cursor = db.execute(
                    "INSERT OR IGNORE INTO snapshots"
                    "(session_id,dataset,command,captured_at,context_json,rows_json,sequence,source_hash) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (
                        session_id,
                        snapshot.dataset,
                        snapshot.command,
                        snapshot.captured_at,
                        json_compact(snapshot.context),
                        json_compact(snapshot.rows),
                        snapshot.sequence,
                        snapshot.source_hash,
                    ),
                )
                if cursor.rowcount:
                    saved += 1
                    self._write_snapshot(session_id, int(cursor.lastrowid), snapshot)

        with (SESSIONS_DIR / session_id / "raw" / "responses.jsonl").open(
            "a", encoding="utf-8"
        ) as handle:
            handle.write(
                json.dumps(
                    {
                        "sequence": sequence,
                        "command": command,
                        "capturedAt": captured_at,
                        "payload": payload,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
        return True, saved

    def _write_snapshot(
        self, session_id: str, snapshot_id: int, snapshot: Snapshot
    ) -> None:
        base = (
            f"{snapshot_id:04d}_{safe_slug(snapshot.dataset)}_"
            f"{safe_slug(snapshot.context.get('rankTypeLabel',''))}"
        )
        root = SESSIONS_DIR / session_id
        (root / "normalized" / f"{base}.json").write_text(
            json.dumps(snapshot.as_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if not snapshot.rows:
            return
        fields, seen = [], set()
        for row in snapshot.rows:
            for key in row:
                if key not in seen:
                    fields.append(key)
                    seen.add(key)
        with (root / "exports" / f"{base}.csv").open(
            "w", newline="", encoding="utf-8-sig"
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(snapshot.rows)

    def write_manifest(self, session_id: str) -> Path:
        summary = self.summary(session_id)
        path = SESSIONS_DIR / session_id / "session.json"
        path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return path

    def summary(self, session_id: str) -> dict[str, Any]:
        with self._connect() as db:
            session = db.execute(
                "SELECT * FROM sessions WHERE id=?", (session_id,)
            ).fetchone()
            datasets = db.execute(
                "SELECT dataset,COUNT(*) snapshot_count,MAX(captured_at) latest_capture "
                "FROM snapshots WHERE session_id=? GROUP BY dataset ORDER BY dataset",
                (session_id,),
            ).fetchall()
            ranking_types = db.execute(
                "SELECT context_json FROM snapshots "
                "WHERE session_id=? AND dataset='alliance_duel_rankings'",
                (session_id,),
            ).fetchall()
        if session is None:
            raise KeyError(session_id)

        dataset_rows = [dict(row) for row in datasets]
        dataset_names = {row["dataset"] for row in dataset_rows}
        rank_labels: set[str] = set()
        for row in ranking_types:
            try:
                context = json.loads(row["context_json"])
                label = str(context.get("rankTypeLabel") or "")
                if label:
                    rank_labels.add(label)
            except (TypeError, json.JSONDecodeError):
                continue

        missing: list[str] = []
        if "alliance_duel_rankings" not in dataset_names:
            missing.append("player rankings")
        else:
            for label, description in (
                ("current_day_combined", "current-day ranking"),
                ("weekly_own_alliance", "My Alliance weekly ranking"),
                ("completed_days", "completed-day history"),
            ):
                if label not in rank_labels:
                    missing.append(description)
        if "alliance_duel_results" not in dataset_names:
            missing.append("official daily results")

        quality = {
            "status": (
                "complete"
                if not missing
                else "results_only"
                if "alliance_duel_results" in dataset_names
                and "alliance_duel_rankings" not in dataset_names
                else "partial"
                if dataset_names
                else "empty"
            ),
            "playerRankingsCaptured": "alliance_duel_rankings" in dataset_names,
            "officialResultsCaptured": "alliance_duel_results" in dataset_names,
            "seasonCaptured": "alliance_duel_season" in dataset_names,
            "rankTypesCaptured": sorted(rank_labels),
            "dashboardReady": (
                "alliance_duel_rankings" in dataset_names
                and "alliance_duel_results" in dataset_names
            ),
            "missing": missing,
        }

        return {
            "schemaVersion": 2,
            "session": dict(session),
            "datasets": dataset_rows,
            "captureQuality": quality,
        }

    def list_sessions(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            ]

    @staticmethod
    def _snapshot_rows(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["context"] = json.loads(item.pop("context_json"))
            item["rows"] = json.loads(item.pop("rows_json"))
            output.append(item)
        return output

    def unsynced(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT id,session_id,dataset,command,captured_at,context_json,"
                "rows_json,sequence,source_hash "
                "FROM snapshots WHERE synced_at IS NULL ORDER BY id"
            ).fetchall()
        return self._snapshot_rows(rows)

    def snapshots_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT id,session_id,dataset,command,captured_at,context_json,"
                "rows_json,sequence,source_hash "
                "FROM snapshots WHERE session_id=? ORDER BY id",
                (session_id,),
            ).fetchall()
        return self._snapshot_rows(rows)

    def latest_session_snapshots(self) -> tuple[str | None, list[dict[str, Any]]]:
        with self._connect() as db:
            latest = db.execute(
                "SELECT id FROM sessions WHERE snapshot_count > 0 "
                "ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        if latest is None:
            return None, []
        session_id = str(latest["id"])
        return session_id, self.snapshots_for_session(session_id)

    def mark_synced(self, ids: Iterable[int]) -> None:
        ids = list(ids)
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        with self._connect() as db:
            db.execute(
                f"UPDATE snapshots SET synced_at=? WHERE id IN ({placeholders})",
                (utc_now(), *ids),
            )

    def package(self, session_id: str) -> Path:
        self.write_manifest(session_id)
        source = SESSIONS_DIR / session_id
        target = SESSIONS_DIR / f"{session_id}.zip"
        if target.exists():
            target.unlink()
        with zipfile.ZipFile(
            target, "w", zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for path in sorted(source.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(source))
        return target
