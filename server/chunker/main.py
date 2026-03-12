"""
Chunker — Stage 2 of the pipeline.

Consumes book metadata from `books-to-process`, reads the raw text from either
local disk or GCS (based on the storage_path in the message), splits it into
sections, and produces each chunk to `book-chunks` for the NLP worker.

Splitting strategy:
  - Detects chapter headings (e.g. "Chapter I", "CHAPTER 1", "Part II")
  - Falls back to fixed 500-word windows if no chapters found

Usage:
    python -m main
    python -m main --dry-run    # prints chunks to stdout instead of producing to Kafka
"""

import os
import re
import json
import logging
import argparse
from pathlib import Path
from dotenv import load_dotenv
from confluent_kafka import Consumer, Producer, KafkaError

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
CONSUME_TOPIC = os.getenv("KAFKA_TOPIC_BOOKS_TO_PROCESS", "books-to-process")
PRODUCE_TOPIC = os.getenv("KAFKA_TOPIC_BOOK_CHUNKS", "book-chunks")
CHUNK_SIZE = 500  # words per window when no chapters detected

CHAPTER_PATTERN = re.compile(
    r"^\s*(chapter\s+[\divxlcIVXLC]+|part\s+[\divxlcIVXLC]+)[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)


def read_text(storage_path: str) -> str:
    if storage_path.startswith("gs://"):
        from google.cloud import storage as gcs
        client = gcs.Client()
        path = storage_path.replace("gs://", "")
        bucket_name, blob_name = path.split("/", 1)
        return client.bucket(bucket_name).blob(blob_name).download_as_text()
    else:
        return Path(storage_path).read_text(encoding="utf-8")


def split_by_chapters(text: str) -> list[tuple[str, str]]:
    """Returns list of (chapter_label, body) tuples."""
    matches = list(CHAPTER_PATTERN.finditer(text))
    if not matches:
        return []

    chapters = []
    for i, match in enumerate(matches):
        label = match.group().strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            chapters.append((label, body))

    return chapters


def split_by_windows(text: str, size: int = CHUNK_SIZE) -> list[str]:
    words = text.split()
    return [" ".join(words[i:i + size]) for i in range(0, len(words), size)]


def chunk_book(text: str) -> list[dict]:
    total_words = len(text.split())
    chunks = []
    word_cursor = 0

    chapters = split_by_chapters(text)

    if chapters:
        log.info(f"  Detected {len(chapters)} chapters")
        for label, body in chapters:
            word_count = len(body.split())
            chunks.append({
                "chunk_index": len(chunks),
                "position_pct": round(word_cursor / total_words, 4) if total_words else 0,
                "chapter": label,
                "text": body,
                "word_count": word_count,
            })
            word_cursor += word_count
    else:
        log.info(f"  No chapters detected, using {CHUNK_SIZE}-word windows")
        for window in split_by_windows(text):
            word_count = len(window.split())
            chunks.append({
                "chunk_index": len(chunks),
                "position_pct": round(word_cursor / total_words, 4) if total_words else 0,
                "chapter": None,
                "text": window,
                "word_count": word_count,
            })
            word_cursor += word_count

    return chunks


def process_book(book: dict, producer: Producer | None):
    book_id = book["book_id"]
    title = book["title"]
    log.info(f"Chunking: {title} (id={book_id})")

    try:
        text = read_text(book["storage_path"])
    except Exception as e:
        log.error(f"Failed to read text for book {book_id}: {e}")
        return

    chunks = chunk_book(text)
    log.info(f"  → {len(chunks)} chunks")

    for chunk in chunks:
        payload = {
            "book_id": book_id,
            "title": title,
            **chunk,
        }

        if producer:
            producer.produce(PRODUCE_TOPIC, value=json.dumps(payload).encode())
        else:
            # dry-run: print summary
            print(
                f"  [{chunk['chunk_index']}] pos={chunk['position_pct']} "
                f"words={chunk['word_count']} chapter={chunk['chapter']!r}"
            )

    if producer:
        producer.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print chunks to stdout instead of producing to Kafka")
    parser.add_argument("--drain", action="store_true", help="Exit automatically when topic is fully consumed")
    args = parser.parse_args()

    producer = None if args.dry_run else Producer({"bootstrap.servers": KAFKA_BOOTSTRAP})

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "group.id": "chunker",
        "auto.offset.reset": "earliest",
    })
    consumer.subscribe([CONSUME_TOPIC])

    log.info(f"Chunker ready. Consuming '{CONSUME_TOPIC}'...")
    if args.dry_run:
        log.info("Dry-run mode: printing chunks, not producing to Kafka")

    idle_polls = 0

    try:
        while True:
            msg = consumer.poll(timeout=5.0)
            if msg is None:
                if args.drain:
                    idle_polls += 1
                    if idle_polls >= 3:
                        log.info("Topic drained, exiting.")
                        break
                continue
            idle_polls = 0
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                log.error(f"Kafka error: {msg.error()}")
                continue

            book = json.loads(msg.value())
            process_book(book, producer)

    except KeyboardInterrupt:
        pass
    finally:
        consumer.close()
        log.info("Chunker stopped.")


if __name__ == "__main__":
    main()
