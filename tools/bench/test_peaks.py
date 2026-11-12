"""peaks.py on job files like the app writes: python -m pytest -q test_peaks.py"""

import json

import peaks


def job(folder, name, **fields):
    (folder / name).mkdir()
    (folder / name / "job.json").write_text(json.dumps(fields), encoding="utf-8")


def test_each_job_that_ran_is_a_row_oldest_first_with_its_peak_in_gigabytes(tmp_path):
    job(tmp_path, "b", model="hunyuan-2-1", device="mps", started=200, seconds=95.4, peak_mb=9728, state="succeeded", notes=["memory_low"])
    job(tmp_path, "a", model="trellis2", device="cuda", preset="512", offload="model", started=100, seconds=60, state="failed", error="HOST_OOM")
    job(tmp_path, "c", model="triposr", device="cpu", started=0, state="queued")  # never ran
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "job.json").write_text("{", encoding="utf-8")
    found = peaks.rows(tmp_path)
    assert [r["model"] for r in found] == ["trellis2", "hunyuan-2-1"]
    assert found[0]["ended"] == "HOST_OOM" and found[0]["step"] == "model" and found[0]["peak_gb"] is None
    assert found[1]["peak_gb"] == 9.5 and found[1]["notes"] == "memory_low" and found[1]["detail"] == "-"


def test_only_jobs_since_the_time_asked(tmp_path):
    job(tmp_path, "old", model="m", started=100)
    job(tmp_path, "new", model="n", started=300)
    assert [r["model"] for r in peaks.rows(tmp_path, since=200)] == ["n"]


def test_a_table_lines_its_columns_up_and_says_what_it_does_not_know(tmp_path):
    job(tmp_path, "a", model="hunyuan-mini", device="cuda", started=100, seconds=66, state="succeeded")
    text = peaks.table(peaks.rows(tmp_path))
    head, line = text.splitlines()
    assert head.split() == ["when", "model", "device", "detail", "step", "peak_gb", "seconds", "ended", "notes"]
    assert line.index("hunyuan-mini") == head.index("model") and "?" in line.split()
