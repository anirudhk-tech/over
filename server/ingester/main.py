"""
Ingester — Stage 1 of the pipeline.

Fetches book catalog from the Gutendex API (Project Gutenberg), downloads
raw text files, stores them in GCS, and produces book metadata to the
`books-to-process` Kafka topic for the chunker to pick up.

Usage:
    python -m main --limit 100                  # GCS + Kafka (production)
    python -m main --limit 100 --local          # local disk + Kafka (no GCS billing needed)
    python -m main --limit 100 --dry-run        # local disk only, no Kafka
"""

import os
import json
import logging
import argparse
import requests
from pathlib import Path
from dotenv import load_dotenv
from confluent_kafka import Producer
from google.cloud import storage

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

GUTENDEX_API = "https://gutendex.com/books"
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
TOPIC = os.getenv("KAFKA_TOPIC_BOOKS_TO_PROCESS", "books-to-process")
GCS_BUCKET = os.getenv("GCS_BUCKET")


def get_producer() -> Producer:
    return Producer({"bootstrap.servers": KAFKA_BOOTSTRAP})


def get_gcs_client() -> storage.Client:
    return storage.Client()


def upload_text(client: storage.Client, book_id: str, text: str) -> str:
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(f"books/{book_id}.txt")
    blob.upload_from_string(text, content_type="text/plain")
    return f"gs://{GCS_BUCKET}/books/{book_id}.txt"


def fetch_page(page: int, language: str) -> dict:
    resp = requests.get(GUTENDEX_API, params={"page": page, "languages": language}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_text_url(book: dict) -> str | None:
    formats = book.get("formats", {})
    return (
        formats.get("text/plain; charset=utf-8")
        or formats.get("text/plain; charset=us-ascii")
        or formats.get("text/plain")
    )


LOCAL_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"


def save_local(book_id: str, title: str, text: str) -> Path:
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    safe_title = "".join(c if c.isalnum() or c in " -_" else "" for c in title)[:60].strip()
    path = LOCAL_DIR / f"{book_id}_{safe_title}.txt"
    path.write_text(text, encoding="utf-8")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="Max books to ingest")
    parser.add_argument("--language", type=str, default="en", help="Language filter (default: en)")
    parser.add_argument("--local", action="store_true", help="Save texts to local disk instead of GCS, still produces to Kafka")
    parser.add_argument("--dry-run", action="store_true", help="Save texts to local disk, skip Kafka entirely")
    args = parser.parse_args()

    use_kafka = not args.dry_run
    use_gcs = not args.local and not args.dry_run

    producer = get_producer() if use_kafka else None
    gcs = get_gcs_client() if use_gcs else None

    queued = 0
    page = 1

    while queued < args.limit:
        log.info(f"Fetching page {page} from Gutendex...")
        data = fetch_page(page, args.language)
        books = data.get("results", [])
        if not books:
            log.info("No more books.")
            break

        for book in books:
            if queued >= args.limit:
                break

            text_url = get_text_url(book)
            if not text_url:
                continue

            book_id = str(book["id"])
            title = book["title"]

            try:
                text_resp = requests.get(text_url, timeout=60)
                text_resp.raise_for_status()
                text = text_resp.text
            except Exception as e:
                log.warning(f"Failed to download text for book {book_id}: {e}")
                continue

            if use_gcs:
                storage_path = upload_text(gcs, book_id, text)
            else:
                storage_path = str(save_local(book_id, title, text))

            queued += 1
            log.info(f"[{queued}/{args.limit}] Stored: {title} (id={book_id})")

            if use_kafka:
                msg = {
                    "book_id": book_id,
                    "title": title,
                    "author": book["authors"][0]["name"] if book.get("authors") else None,
                    "subjects": book.get("subjects", []),
                    "language": args.language,
                    "storage_path": storage_path,
                }
                producer.produce(TOPIC, value=json.dumps(msg).encode())

        if use_kafka:
            producer.flush()
        page += 1

    if use_kafka:
        producer.flush()
    log.info(f"Done. {queued} books ingested.")


if __name__ == "__main__":
    main()
