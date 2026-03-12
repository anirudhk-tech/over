"""
orchestrate.py — full pipeline runner.

Cleans up local files and BigQuery tables, then runs each stage in order:
  1. Ingest books from Gutenberg → local disk + Kafka
  2. Chunker → Kafka
  3. NLP Worker → Kafka
  4. Stream Processor → BigQuery
  5. Build character stats → BigQuery
  6. Start API server (background)
  7. Start frontend client (background)

Usage:
    python orchestrate.py --limit 50
    python orchestrate.py --limit 50 --skip-clean
"""

import os
import sys
import shutil
import subprocess
import argparse
import signal
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

ROOT       = Path(__file__).resolve().parent.parent   # project root
SERVER_DIR = Path(__file__).resolve().parent
DATA_DIR   = SERVER_DIR / "data" / "raw"
CLIENT_DIR = ROOT / "client"

BQ_PROJECT = os.getenv("GCP_PROJECT_ID")
BQ_DATASET = os.getenv("BQ_DATASET", "overdue")

TABLES = ["books", "book_arcs", "characters"]

background_procs: list[subprocess.Popen] = []


def step(title: str):
    log.info("")
    log.info(f"{'─' * 60}")
    log.info(f"  {title}")
    log.info(f"{'─' * 60}")


def run(cmd: list[str], cwd=SERVER_DIR):
    log.info(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        log.error(f"Command failed with exit code {result.returncode}")
        sys.exit(result.returncode)


def run_background(cmd: list[str], cwd=SERVER_DIR) -> subprocess.Popen:
    log.info(f"$ {' '.join(cmd)}  (background)")
    proc = subprocess.Popen(cmd, cwd=cwd)
    background_procs.append(proc)
    return proc


def clean_local():
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
        log.info(f"Deleted {DATA_DIR}")
    else:
        log.info("No local data to clean.")


def clean_bigquery():
    from google.cloud import bigquery
    bq = bigquery.Client(project=BQ_PROJECT)
    for table in TABLES:
        table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{table}"
        try:
            table_ref = bq.get_table(table_id)
            schema = table_ref.schema
            bq.delete_table(table_id)
            bq.create_table(bigquery.Table(table_id, schema=schema))
            log.info(f"Cleared BigQuery table: {table_id}")
        except Exception as e:
            log.warning(f"Could not clear {table_id}: {e}")


def shutdown(sig, frame):
    log.info("\nShutting down background processes...")
    for proc in background_procs:
        proc.terminate()
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",      type=int, default=10,    help="Number of books to ingest")
    parser.add_argument("--skip-clean", action="store_true",     help="Skip cleanup step")
    parser.add_argument("--no-client",  action="store_true",     help="Skip starting the frontend")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    python = sys.executable

    # ------------------------------------------------------------------
    # 1. Clean up
    # ------------------------------------------------------------------
    if not args.skip_clean:
        step("Cleaning up")
        clean_local()
        clean_bigquery()
    else:
        log.info("Skipping cleanup (--skip-clean)")

    # ------------------------------------------------------------------
    # 2. Ingest
    # ------------------------------------------------------------------
    step(f"Stage 1 — Ingesting {args.limit} books from Gutenberg")
    run([python, "ingester/main.py", "--local", f"--limit={args.limit}"])

    # ------------------------------------------------------------------
    # 3. Chunk
    # ------------------------------------------------------------------
    step("Stage 2 — Chunking books")
    run([python, "chunker/main.py", "--drain"])

    # ------------------------------------------------------------------
    # 4. NLP
    # ------------------------------------------------------------------
    step("Stage 3 — NLP analysis")
    run([python, "nlp-worker/main.py", "--drain"])

    # ------------------------------------------------------------------
    # 5. Stream processor → BigQuery
    # ------------------------------------------------------------------
    step("Stage 4 — Writing arc data to BigQuery")
    run([python, "stream-processor/main.py", "--drain"])

    # ------------------------------------------------------------------
    # 6. Build character stats
    # ------------------------------------------------------------------
    step("Stage 5 — Building character stats")
    run([python, "scripts/build_characters.py"])

    # ------------------------------------------------------------------
    # 7. Start API
    # ------------------------------------------------------------------
    step("Stage 6 — Starting API server")
    run_background([python, "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"])
    log.info("API running at http://localhost:8000")

    # ------------------------------------------------------------------
    # 8. Start client
    # ------------------------------------------------------------------
    if not args.no_client:
        step("Stage 7 — Starting frontend")
        run_background(["npm", "run", "dev"], cwd=CLIENT_DIR)
        log.info("Frontend running at http://localhost:5173")

    # ------------------------------------------------------------------
    # Done
    # ------------------------------------------------------------------
    log.info("")
    log.info("Pipeline complete. Press Ctrl+C to stop the servers.")
    log.info("")

    for proc in background_procs:
        proc.wait()


if __name__ == "__main__":
    main()
