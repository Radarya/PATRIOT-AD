"""Penyimpanan forensik offline-first (SQLite WAL) + log audit berantai SHA-256.

Implementasi PRD §7:

- Setiap insiden memuat ``seq_id``, ``timestamp``, ``schema_version``,
  ``source_identity``, ``event_type``, ``classification``, ``response_level``,
  ``structured_evidence``, ``prev_hash``, ``record_hash``.
- ``record_hash = SHA256(canonical_json(record tanpa record_hash))``.
- Serialisasi kanonik: key terurut, UTF-8, tanpa spasi, ``null`` eksplisit,
  NaN/Inf dilarang, dan float bernilai bulat ditulis sebagai integer
  (``30.0`` → ``30``) agar hash identik dengan ``JSON.stringify`` di browser.
- Setiap ``checkpoint_every`` rekaman, ``seq_id`` + head hash ditulis ke file
  checkpoint terpisah (JSONL) untuk mendeteksi pemotongan ujung rantai.

Batasan yang disadari: penyerang yang menguasai DB *dan* file checkpoint
sekaligus dapat menulis ulang keduanya; checkpoint sebaiknya disalin ke media
terpisah (mis. ekspor berkala) untuk bukti yang lebih kuat.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .schemas import SCHEMA_VERSION, ChainError, Telemetry, VerifyReport

GENESIS_HASH = hashlib.sha256(b"PATRIOT-AD/forensic-chain/genesis/v1").hexdigest()

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS telemetry (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at      TEXT    NOT NULL,
    device_id        TEXT    NOT NULL,
    seq              INTEGER NOT NULL,
    uptime_ms        INTEGER NOT NULL,
    temperature_c    REAL,
    humidity_pct     REAL,
    fan_reported     TEXT    NOT NULL,
    current_ma       REAL,
    bus_v            REAL,
    interlock_active INTEGER NOT NULL,
    failsafe_active  INTEGER NOT NULL,
    accepted         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device ON telemetry(device_id, id);

CREATE TABLE IF NOT EXISTS incidents (
    seq_id              INTEGER PRIMARY KEY,
    timestamp           TEXT    NOT NULL,
    schema_version      TEXT    NOT NULL,
    source_identity     TEXT    NOT NULL,
    event_type          TEXT    NOT NULL,
    classification      TEXT    NOT NULL,
    response_level      INTEGER NOT NULL,
    structured_evidence TEXT    NOT NULL,
    prev_hash           TEXT    NOT NULL,
    record_hash         TEXT    NOT NULL
);
"""

_HASHED_FIELDS = (
    "seq_id",
    "timestamp",
    "schema_version",
    "source_identity",
    "event_type",
    "classification",
    "response_level",
    "structured_evidence",
    "prev_hash",
)


def _normalize(value: Any) -> Any:
    if isinstance(value, Enum):
        return _normalize(value.value)
    if isinstance(value, bool) or value is None or isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {str(k): _normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(v) for v in value]
    raise TypeError(f"Tipe tidak didukung dalam bukti forensik: {type(value).__name__}")


def canonical_json(obj: Any) -> str:
    return json.dumps(
        _normalize(obj),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def compute_record_hash(record: dict[str, Any]) -> str:
    payload = {field: record[field] for field in _HASHED_FIELDS}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class ForensicDB:
    """Akses SQLite thread-safe (satu koneksi, satu penulis, dikunci ``Lock``)."""

    def __init__(self, db_path: Path, checkpoint_path: Path, checkpoint_every: int = 25) -> None:
        self.db_path = Path(db_path)
        self.checkpoint_path = Path(checkpoint_path)
        self.checkpoint_every = checkpoint_every
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.executescript(_SCHEMA_SQL)

    # ------------------------------------------------------------------ util
    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def ping(self) -> bool:
        try:
            with self._lock:
                self._conn.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    # ------------------------------------------------------------- telemetry
    def insert_telemetry(self, t: Telemetry, *, accepted: bool, received_at: str | None = None) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT INTO telemetry (received_at, device_id, seq, uptime_ms, temperature_c,
                       humidity_pct, fan_reported, current_ma, bus_v, interlock_active,
                       failsafe_active, accepted)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    received_at or _utc_now_iso(),
                    t.device_id,
                    t.seq,
                    t.uptime_ms,
                    t.temperature_c,
                    t.humidity_pct,
                    t.fan_reported.value,
                    t.current_ma,
                    t.bus_v,
                    int(t.interlock_active),
                    int(t.failsafe_active),
                    int(accepted),
                ),
            )

    def recent_telemetry(self, device_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        sql = "SELECT * FROM telemetry"
        params: list[Any] = []
        if device_id:
            sql += " WHERE device_id = ?"
            params.append(device_id)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        result = [dict(r) for r in reversed(rows)]
        for row in result:
            row["interlock_active"] = bool(row["interlock_active"])
            row["failsafe_active"] = bool(row["failsafe_active"])
            row["accepted"] = bool(row["accepted"])
        return result

    # ------------------------------------------------------------- incidents
    def append_incident(
        self,
        *,
        source_identity: str,
        event_type: str,
        classification: str,
        response_level: int,
        evidence: dict[str, Any],
        timestamp: str | None = None,
    ) -> dict[str, Any]:
        """Tambah satu rekaman ke rantai secara atomik dan kembalikan rekamannya."""
        evidence_json = canonical_json(evidence)
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                last = self._conn.execute(
                    "SELECT seq_id, record_hash FROM incidents ORDER BY seq_id DESC LIMIT 1"
                ).fetchone()
                record: dict[str, Any] = {
                    "seq_id": (last["seq_id"] + 1) if last else 1,
                    "timestamp": timestamp or _utc_now_iso(),
                    "schema_version": SCHEMA_VERSION,
                    "source_identity": source_identity,
                    "event_type": event_type,
                    "classification": classification,
                    "response_level": int(response_level),
                    "structured_evidence": json.loads(evidence_json),
                    "prev_hash": last["record_hash"] if last else GENESIS_HASH,
                }
                record["record_hash"] = compute_record_hash(record)
                self._conn.execute(
                    """INSERT INTO incidents (seq_id, timestamp, schema_version, source_identity,
                           event_type, classification, response_level, structured_evidence,
                           prev_hash, record_hash)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        record["seq_id"],
                        record["timestamp"],
                        record["schema_version"],
                        record["source_identity"],
                        record["event_type"],
                        record["classification"],
                        record["response_level"],
                        evidence_json,
                        record["prev_hash"],
                        record["record_hash"],
                    ),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            if record["seq_id"] % self.checkpoint_every == 0:
                self._write_checkpoint(record["seq_id"], record["record_hash"])
        return record

    def _write_checkpoint(self, seq_id: int, head_hash: str) -> None:
        line = canonical_json({"seq_id": seq_id, "head_hash": head_hash, "written_at": _utc_now_iso()})
        with self.checkpoint_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
            os.fsync(fh.fileno())

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> dict[str, Any]:
        record = dict(row)
        record["structured_evidence"] = json.loads(record["structured_evidence"])
        return record

    def incidents(self, limit: int = 100, after_seq: int | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if after_seq is None:
                rows = self._conn.execute(
                    "SELECT * FROM incidents ORDER BY seq_id DESC LIMIT ?", (limit,)
                ).fetchall()
                rows = list(reversed(rows))
            else:
                rows = self._conn.execute(
                    "SELECT * FROM incidents WHERE seq_id > ? ORDER BY seq_id ASC LIMIT ?",
                    (after_seq, limit),
                ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def export_chain(self) -> dict[str, Any]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM incidents ORDER BY seq_id ASC").fetchall()
        return {
            "genesis_hash": GENESIS_HASH,
            "schema_version": SCHEMA_VERSION,
            "records": [self._row_to_record(r) for r in rows],
            "checkpoints": self._read_checkpoints()[0],
        }

    # -------------------------------------------------------------- verifier
    def _read_checkpoints(self) -> tuple[list[dict[str, Any]], list[ChainError]]:
        checkpoints: list[dict[str, Any]] = []
        errors: list[ChainError] = []
        if not self.checkpoint_path.is_file():
            return checkpoints, errors
        for lineno, line in enumerate(self.checkpoint_path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                cp = json.loads(line)
                checkpoints.append({"seq_id": int(cp["seq_id"]), "head_hash": str(cp["head_hash"])})
            except (ValueError, KeyError, TypeError):
                errors.append(
                    ChainError(seq_id=None, kind="CHECKPOINT_CORRUPT", detail=f"Baris checkpoint {lineno} rusak")
                )
        return checkpoints, errors

    def verify_chain(self) -> VerifyReport:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM incidents ORDER BY seq_id ASC").fetchall()

        errors: list[ChainError] = []
        hashes: dict[int, str] = {}
        expected_seq = 1
        expected_prev = GENESIS_HASH

        for row in rows:
            record = self._row_to_record(row)
            seq_id = record["seq_id"]
            if seq_id != expected_seq:
                errors.append(
                    ChainError(
                        seq_id=seq_id,
                        kind="SEQUENCE_GAP",
                        detail=f"Diharapkan seq_id {expected_seq}, ditemukan {seq_id}",
                    )
                )
            if record["prev_hash"] != expected_prev:
                errors.append(
                    ChainError(seq_id=seq_id, kind="BROKEN_LINK", detail="prev_hash tidak cocok dengan rekaman sebelumnya")
                )
            if compute_record_hash(record) != record["record_hash"]:
                errors.append(
                    ChainError(seq_id=seq_id, kind="HASH_MISMATCH", detail="Isi rekaman berubah setelah dicatat")
                )
            hashes[seq_id] = record["record_hash"]
            expected_prev = record["record_hash"]
            expected_seq = seq_id + 1

        checkpoints, cp_errors = self._read_checkpoints()
        errors.extend(cp_errors)
        max_seq = max(hashes) if hashes else 0
        for cp in checkpoints:
            seq_id = cp["seq_id"]
            if seq_id not in hashes:
                kind = "TRUNCATION" if seq_id > max_seq else "MISSING_RECORD"
                errors.append(
                    ChainError(seq_id=seq_id, kind=kind, detail=f"Checkpoint merujuk seq_id {seq_id} yang tidak ada")
                )
            elif hashes[seq_id] != cp["head_hash"]:
                errors.append(
                    ChainError(seq_id=seq_id, kind="CHECKPOINT_MISMATCH", detail="Hash rekaman berbeda dari checkpoint")
                )

        head_seq = max_seq or None
        return VerifyReport(
            ok=not errors,
            records_checked=len(rows),
            head_seq=head_seq,
            head_hash=hashes.get(max_seq) if head_seq else None,
            checkpoints_checked=len(checkpoints),
            errors=errors,
        )
