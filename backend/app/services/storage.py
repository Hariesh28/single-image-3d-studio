from __future__ import annotations
import json, os, tempfile, uuid
from pathlib import Path
from ..config import settings

class ArtifactNotFound(FileNotFoundError): pass

def new_scene_dir() -> tuple[str, Path]:
    sid = uuid.uuid4().hex; path = settings.scene_dir / sid; path.mkdir(parents=True, exist_ok=False); return sid, path

def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def save_json(path: Path, value: object) -> None:
    atomic_write_bytes(path, json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8"))

def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

def safe_child(root: Path, relative_name: str) -> Path:
    root = root.resolve(); candidate = (root / relative_name).resolve()
    if candidate == root or root not in candidate.parents: raise ArtifactNotFound(relative_name)
    return candidate
