from __future__ import annotations

import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Lock
from time import time
from typing import Callable


@dataclass
class Job:
    scene_id: str
    status: str = "queued"
    progress: int = 0
    stage: str = "queued"
    message: str = "Waiting for GPU worker"
    error: str | None = None
    started_at: float | None = None
    finished_at: float | None = None
    events: list[dict] = field(default_factory=list)


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.lock = Lock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="s3d-gpu")

    def create(self, scene_id: str, fn: Callable, *args) -> None:
        with self.lock:
            job = Job(scene_id=scene_id)
            self.jobs[scene_id] = job
            self._record_locked(job, "queued", 0, "queued", "Waiting for GPU worker")
        self.pool.submit(self._run, scene_id, fn, *args)

    def _record_locked(self, job: Job, status: str, progress: int, stage: str, message: str) -> None:
        job.status = status
        job.progress = max(0, min(100, int(progress)))
        job.stage = stage
        job.message = message
        job.events.append({
            "ts": time(),
            "status": status,
            "progress": job.progress,
            "stage": stage,
            "message": message,
        })
        if len(job.events) > 200:
            del job.events[: len(job.events) - 200]

    def _run(self, scene_id: str, fn: Callable, *args) -> None:
        with self.lock:
            job = self.jobs[scene_id]
            job.started_at = time()
            self._record_locked(job, "processing", 1, "starting", "Starting reconstruction")

        def progress(stage: str, value: int, message: str) -> None:
            with self.lock:
                job = self.jobs[scene_id]
                self._record_locked(job, "processing", value, stage, message)

        try:
            fn(*args, progress=progress)
            with self.lock:
                job = self.jobs[scene_id]
                job.finished_at = time()
                self._record_locked(job, "complete", 100, "complete", "Scene ready")
        except Exception as exc:
            with self.lock:
                job = self.jobs[scene_id]
                job.error = f"{type(exc).__name__}: {exc}"
                job.finished_at = time()
                self._record_locked(job, "failed", job.progress, "error", job.error)
            traceback.print_exc()

    def get(self, scene_id: str) -> Job | None:
        with self.lock:
            return self.jobs.get(scene_id)

    def snapshot(self, scene_id: str) -> dict | None:
        with self.lock:
            job = self.jobs.get(scene_id)
            if job is None:
                return None
            return {
                "scene_id": job.scene_id,
                "status": job.status,
                "progress": job.progress,
                "stage": job.stage,
                "message": job.message,
                "error": job.error,
                "started_at": job.started_at,
                "finished_at": job.finished_at,
                "events": list(job.events),
            }
