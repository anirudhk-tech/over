"""
NLP Worker — Stage 3 of the pipeline.

Consumes text chunks from `book-chunks`, runs NLP analysis on each chunk,
and produces arc event results to `arc-events`.

Analysis per chunk:
  - Sentiment score      — DistilBERT: -1.0 (negative) to 1.0 (positive)
  - Tension score        — composite of sentiment negativity + conflict density
  - Pacing score         — sentence length variance + dialogue ratio
  - Conflict density     — frequency of conflict-related keywords
  - Dominant characters  — top PERSON entities from spaCy NER

Usage:
    python -m main
    python -m main --dry-run    # prints results to stdout instead of producing to Kafka
"""

import os
import re
import json
import logging
import argparse
import statistics
from dotenv import load_dotenv
from confluent_kafka import Consumer, Producer, KafkaError
from transformers import pipeline as hf_pipeline
import spacy

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
CONSUME_TOPIC = os.getenv("KAFKA_TOPIC_BOOK_CHUNKS", "book-chunks")
PRODUCE_TOPIC = os.getenv("KAFKA_TOPIC_ARC_EVENTS", "arc-events")

CONFLICT_KEYWORDS = {
    # Violence & physical conflict
    "fight", "fighting", "fought", "battle", "war", "warfare", "attack", "attacked",
    "assault", "strike", "struck", "stab", "stabbed", "shoot", "shot", "bomb",
    "explosion", "destroy", "destroyed", "siege", "ambush", "clash", "brawl",
    "slaughter", "massacre", "execute", "executed",

    # Death & injury
    "murder", "kill", "killed", "killing", "death", "dead", "die", "died", "dying",
    "corpse", "blood", "bleed", "bleeding", "wound", "wounded", "injury", "injured",
    "suffer", "suffering", "agony", "pain", "torture",

    # Pursuit & threat
    "chase", "chased", "hunt", "hunted", "trap", "trapped", "escape", "flee",
    "fled", "danger", "dangerous", "threat", "threaten", "threatened", "hostage",
    "prisoner", "capture", "captured",

    # Betrayal & conflict
    "betray", "betrayal", "betrayed", "enemy", "enemies", "traitor", "treachery",
    "deceive", "deceived", "lie", "lied", "conspiracy", "corrupt", "corruption",
    "revenge", "vengeance", "retaliate",

    # Emotional intensity
    "anger", "angry", "rage", "furious", "fury", "hate", "hatred", "despair",
    "desperate", "terror", "terrified", "horror", "horrified", "fear", "feared",
    "panic", "shock", "shocked", "scream", "screamed", "cry", "wept", "grief",
    "anguish", "dread", "paranoia",

    # Weapons & tools of conflict
    "weapon", "sword", "knife", "gun", "rifle", "pistol", "blade", "arrow", "poison",
}

# Models are loaded once and reused across all chunks
_sentiment_model = None
_nlp = None


def get_sentiment_model():
    global _sentiment_model
    if _sentiment_model is None:
        log.info("Loading sentiment model (DistilBERT)...")
        _sentiment_model = hf_pipeline(
            "sentiment-analysis",
            model="distilbert-base-uncased-finetuned-sst-2-english",
            truncation=True,
            max_length=512,
        )
    return _sentiment_model


def get_nlp():
    global _nlp
    if _nlp is None:
        log.info("Loading spaCy model...")
        _nlp = spacy.load("en_core_web_sm")
    return _nlp


def score_sentiment(text: str) -> float:
    """Returns -1.0 (very negative) to 1.0 (very positive)."""
    result = get_sentiment_model()(text[:1024])[0]
    score = result["score"]
    return round(score if result["label"] == "POSITIVE" else -score, 4)


def score_conflict_density(text: str) -> float:
    words = re.findall(r"\b\w+\b", text.lower())
    if not words:
        return 0.0
    hits = sum(1 for w in words if w in CONFLICT_KEYWORDS)
    return round(hits / len(words), 4)


def score_pacing(text: str) -> float:
    """High = fast pacing (short sentences, lots of dialogue)."""
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    if not sentences:
        return 0.5

    lengths = [len(s.split()) for s in sentences]
    avg_len = statistics.mean(lengths)
    dialogue_ratio = sum(1 for s in sentences if s.startswith(('"', "'"))) / len(sentences)

    # Shorter avg sentence = faster pacing
    length_score = max(0.0, min(1.0, 1.0 - (avg_len - 5) / 35))
    return round((length_score + dialogue_ratio) / 2, 4)


def extract_characters(text: str) -> list[str]:
    doc = get_nlp()(text[:5000])
    freq: dict[str, int] = {}
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            freq[ent.text] = freq.get(ent.text, 0) + 1
    return [name for name, _ in sorted(freq.items(), key=lambda x: -x[1])[:5]]


def analyze(chunk: dict) -> dict:
    text = chunk["text"]
    sentiment = score_sentiment(text)
    conflict = score_conflict_density(text)

    # Tension: high when sentiment is negative AND conflict keywords are dense
    negativity = (1.0 - sentiment) / 2  # maps -1..1 → 1..0
    tension = round(negativity * 0.6 + conflict * 0.4, 4)

    return {
        "book_id":             chunk["book_id"],
        "chunk_index":         chunk["chunk_index"],
        "position_pct":        chunk["position_pct"],
        "chapter":             chunk.get("chapter"),
        "word_count":          chunk.get("word_count"),
        "sentiment_score":     sentiment,
        "tension_score":       tension,
        "pacing_score":        score_pacing(text),
        "conflict_density":    conflict,
        "dominant_characters": extract_characters(text),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print results to stdout instead of producing to Kafka")
    args = parser.parse_args()

    producer = None if args.dry_run else Producer({"bootstrap.servers": KAFKA_BOOTSTRAP})

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "group.id": "nlp-worker",
        "auto.offset.reset": "earliest",
    })
    consumer.subscribe([CONSUME_TOPIC])

    log.info(f"NLP worker ready. Consuming '{CONSUME_TOPIC}'...")
    if args.dry_run:
        log.info("Dry-run mode: printing results, not producing to Kafka")

    try:
        while True:
            msg = consumer.poll(timeout=5.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                log.error(f"Kafka error: {msg.error()}")
                continue

            chunk = json.loads(msg.value())

            try:
                result = analyze(chunk)
            except Exception as e:
                log.error(f"Analysis failed for book={chunk.get('book_id')} chunk={chunk.get('chunk_index')}: {e}")
                continue

            if args.dry_run:
                print(json.dumps(result, indent=2))
            else:
                producer.produce(PRODUCE_TOPIC, value=json.dumps(result).encode())
                producer.poll(0)
                log.info(f"book={result['book_id']} chunk={result['chunk_index']} tension={result['tension_score']} sentiment={result['sentiment_score']}")

    except KeyboardInterrupt:
        pass
    finally:
        if producer:
            producer.flush()
        consumer.close()
        log.info("NLP worker stopped.")


if __name__ == "__main__":
    main()
