terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  bucket_name = var.gcs_bucket_name != "" ? var.gcs_bucket_name : "${var.project_id}-overdue-books"
}

# ----------------------------------------------------------------------
# BigQuery Dataset
# ----------------------------------------------------------------------

resource "google_bigquery_dataset" "overdue" {
  dataset_id    = var.dataset_id
  friendly_name = "Overdue — The Shape of Every Story"
  description   = "Narrative arc analytics: NLP-processed book texts from Project Gutenberg."
  location      = var.region

  labels = {
    project = "overdue"
    env     = "dev"
  }
}

# ----------------------------------------------------------------------
# Table: books
# ----------------------------------------------------------------------

resource "google_bigquery_table" "books" {
  dataset_id          = google_bigquery_dataset.overdue.dataset_id
  table_id            = "books"
  description         = "Book metadata from Project Gutenberg."
  deletion_protection = false

  schema = jsonencode([
    { name = "book_id",      type = "STRING",    mode = "REQUIRED", description = "Gutenberg book ID" },
    { name = "title",        type = "STRING",    mode = "REQUIRED" },
    { name = "author",       type = "STRING",    mode = "NULLABLE" },
    { name = "subjects",     type = "STRING",    mode = "REPEATED", description = "Subject/genre tags from Gutenberg" },
    { name = "language",     type = "STRING",    mode = "NULLABLE" },
    { name = "publish_year", type = "INTEGER",   mode = "NULLABLE" },
    { name = "word_count",   type = "INTEGER",   mode = "NULLABLE" },
    { name = "gcs_path",     type = "STRING",    mode = "NULLABLE", description = "Raw text location in GCS" },
    { name = "processed_at", type = "TIMESTAMP", mode = "NULLABLE", description = "When NLP processing completed" },
  ])

  clustering = ["author", "book_id"]
}

# ----------------------------------------------------------------------
# Table: book_arcs
# ----------------------------------------------------------------------

resource "google_bigquery_table" "book_arcs" {
  dataset_id          = google_bigquery_dataset.overdue.dataset_id
  table_id            = "book_arcs"
  description         = "NLP arc analysis results — one row per chunk per book."
  deletion_protection = false

  schema = jsonencode([
    { name = "book_id",           type = "STRING",  mode = "REQUIRED" },
    { name = "chunk_index",       type = "INTEGER", mode = "REQUIRED", description = "Sequential chunk number (0-based)" },
    { name = "position_pct",      type = "FLOAT",   mode = "REQUIRED", description = "0.0–1.0 position through the book" },
    { name = "chapter",           type = "STRING",  mode = "NULLABLE", description = "Chapter label if detected" },
    { name = "word_count",        type = "INTEGER", mode = "NULLABLE" },
    { name = "sentiment_score",   type = "FLOAT",   mode = "NULLABLE", description = "-1.0 (negative) to 1.0 (positive)" },
    { name = "tension_score",     type = "FLOAT",   mode = "NULLABLE", description = "0.0–1.0 composite tension" },
    { name = "pacing_score",      type = "FLOAT",   mode = "NULLABLE", description = "0.0–1.0 slow to fast" },
    { name = "conflict_density",  type = "FLOAT",   mode = "NULLABLE", description = "Conflict keyword ratio" },
    { name = "dominant_characters", type = "STRING", mode = "REPEATED", description = "Top characters present in this chunk" },
  ])

  range_partitioning {
    field = "chunk_index"
    range {
      start    = 0
      end      = 10000
      interval = 500
    }
  }

  clustering = ["book_id"]
}

# ----------------------------------------------------------------------
# Table: characters
# ----------------------------------------------------------------------

resource "google_bigquery_table" "characters" {
  dataset_id          = google_bigquery_dataset.overdue.dataset_id
  table_id            = "characters"
  description         = "Per-book character presence extracted by NER."
  deletion_protection = false

  schema = jsonencode([
    { name = "book_id",              type = "STRING",  mode = "REQUIRED" },
    { name = "character_name",       type = "STRING",  mode = "REQUIRED" },
    { name = "mention_count",        type = "INTEGER", mode = "NULLABLE" },
    { name = "first_appearance_pct", type = "FLOAT",   mode = "NULLABLE", description = "Position (0.0–1.0) of first mention" },
    { name = "last_appearance_pct",  type = "FLOAT",   mode = "NULLABLE", description = "Position (0.0–1.0) of last mention" },
    { name = "peak_presence_pct",    type = "FLOAT",   mode = "NULLABLE", description = "Position with highest mention density" },
  ])

  clustering = ["book_id"]
}

# ----------------------------------------------------------------------
# GCS Bucket: raw book texts
# ----------------------------------------------------------------------

resource "google_storage_bucket" "books" {
  name          = local.bucket_name
  location      = var.region
  force_destroy = true
  storage_class = "STANDARD"

  uniform_bucket_level_access = true

  labels = {
    project = "overdue"
    env     = "dev"
  }
}

# ----------------------------------------------------------------------
# Service Account
# ----------------------------------------------------------------------

resource "google_service_account" "pipeline" {
  account_id   = "overdue-pipeline"
  display_name = "Overdue Pipeline Service Account"
  description  = "Used by ingester, chunker, NLP worker, stream processor, and API."
}

resource "google_project_iam_member" "pipeline_bq_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.pipeline.email}"
}

resource "google_project_iam_member" "pipeline_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.pipeline.email}"
}

resource "google_project_iam_member" "pipeline_gcs_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.pipeline.email}"
}
