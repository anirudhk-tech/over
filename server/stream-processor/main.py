"""
Stream Processor — Stage 4 of the pipeline.

Consumes arc event results from `arc-events` and writes them to BigQuery.
This is a Python alternative to the Kotlin implementation in src/.

Usage:
    python main.py
    python main.py --dry-run    # prints rows to stdout instead of writing to BigQuery
"""

import os
import json
import logging
import argparse
from dotenv import load_dotenv
from confluent_kafka import Consumer, KafkaError
from google.cloud import bigquery

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
CONSUME_TOPIC   = os.getenv("KAFKA_TOPIC_ARC_EVENTS", "arc-events")
BQ_PROJECT      = os.getenv("GCP_PROJECT_ID")
BQ_DATASET      = os.getenv("BQ_DATASET", "overdue")
FLUSH_EVERY     = int(os.getenv("FLUSH_EVERY", "100"))


def get_bq_client():
    return bigquery.Client(project=BQ_PROJECT)


def to_row(event: dict) -> dict:
    return {
        "book_id":             event.get("book_id"),
        "chunk_index":         event.get("chunk_index"),
        "position_pct":        event.get("position_pct"),
        "chapter":             event.get("chapter"),
        "word_count":          event.get("word_count"),
        "sentiment_score":     event.get("sentiment_score"),
        "tension_score":       event.get("tension_score"),
        "pacing_score":        event.get("pacing_score"),
        "conflict_density":    event.get("conflict_density"),
        "dominant_characters": event.get("dominant_characters", []),
    }


def flush(bq: bigquery.Client, rows: list[dict]):
    table_id = f"{BQ_PROJECT}.{BQ_DATASET}.book_arcs"
    job = bq.load_table_from_json(rows, table_id)
    job.result()  # wait for the load job to complete
    if job.errors:
        log.error(f"BigQuery load errors: {job.errors}")
    else:
        log.info(f"Flushed {len(rows)} rows → {table_id}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print rows to stdout instead of writing to BigQuery")
    parser.add_argument("--drain", action="store_true", help="Exit automatically when topic is fully consumed")
    args = parser.parse_args()

    bq = None if args.dry_run else get_bq_client()

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "group.id":          "stream-processor",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    })
    consumer.subscribe([CONSUME_TOPIC])

    log.info(f"Stream processor ready. Consuming '{CONSUME_TOPIC}'...")
    if args.dry_run:
        log.info("Dry-run mode: printing rows, not writing to BigQuery")

    buffer = []
    idle_polls = 0

    try:
        while True:
            msg = consumer.poll(timeout=5.0)

            if msg is None:
                if buffer:
                    if args.dry_run:
                        print(json.dumps(buffer, indent=2))
                    else:
                        flush(bq, buffer)
                        consumer.commit()
                    buffer.clear()
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

            event = json.loads(msg.value())
            buffer.append(to_row(event))

            if len(buffer) >= FLUSH_EVERY:
                if args.dry_run:
                    print(json.dumps(buffer, indent=2))
                else:
                    flush(bq, buffer)
                    consumer.commit()
                buffer.clear()

    except KeyboardInterrupt:
        pass
    finally:
        if buffer and not args.dry_run and bq:
            flush(bq, buffer)
            consumer.commit()
        consumer.close()
        log.info("Stream processor stopped.")


if __name__ == "__main__":
    main()
