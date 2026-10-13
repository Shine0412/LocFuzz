"""任务内存存储：dict + lock，管理 FuzzJob 生命周期。"""
import shutil
import threading
import uuid
from pathlib import Path

from .job import FuzzJob

_lock = threading.Lock()
_jobs = {}
MAX_JOBS = 10  # 同时运行的任务上限（服务器 CPU 保护）


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        (self.data_dir / "jobs").mkdir(parents=True, exist_ok=True)

    def _create(self, seeds: list, per_seed: int, timeout_ms: int) -> FuzzJob:
        job_id = uuid.uuid4().hex[:12]
        job = FuzzJob(job_id, seeds, per_seed, timeout_ms,
                      self.data_dir / "jobs" / job_id)
        _jobs[job_id] = job
        job.start()
        return job

    def create(self, seeds: list, per_seed: int, timeout_ms: int) -> FuzzJob:
        with _lock:
            running = sum(1 for j in _jobs.values() if j.status == "running")
            if running >= MAX_JOBS:
                raise RuntimeError(
                    f"同时运行的任务已达上限（{MAX_JOBS}），请等待已有任务完成")
            return self._create(seeds, per_seed, timeout_ms)

    def rerun(self, job_id: str) -> FuzzJob:
        """以同配置重新发起一个任务。"""
        old = _jobs.get(job_id)
        if not old:
            raise KeyError(job_id)
        with _lock:
            running = sum(1 for j in _jobs.values() if j.status == "running")
            if running >= MAX_JOBS:
                raise RuntimeError(
                    f"同时运行的任务已达上限（{MAX_JOBS}），请等待已有任务完成")
            return self._create(old.seeds, old.per_seed, old.timeout_ms)

    def delete(self, job_id: str):
        """删除任务记录与磁盘数据；运行中的任务先停止。"""
        job = _jobs.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job.status == "running":
            job.stop()
            raise RuntimeError("任务正在运行，已发送停止指令，请稍后再删除")
        with _lock:
            _jobs.pop(job_id, None)
        shutil.rmtree(job.job_dir, ignore_errors=True)

    def get(self, job_id: str):
        return _jobs.get(job_id)

    def list(self):
        with _lock:
            return sorted(_jobs.values(), key=lambda j: j.created_at,
                          reverse=True)
