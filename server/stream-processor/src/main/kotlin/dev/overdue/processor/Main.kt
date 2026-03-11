package dev.overdue.processor

import com.google.cloud.bigquery.BigQueryOptions
import com.google.cloud.bigquery.InsertAllRequest
import com.google.cloud.bigquery.TableId
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.apache.kafka.clients.consumer.ConsumerConfig
import org.apache.kafka.clients.consumer.KafkaConsumer
import org.apache.kafka.common.serialization.StringDeserializer
import java.time.Duration
import java.util.Properties

private val log = KotlinLogging.logger {}

private val json = Json { ignoreUnknownKeys = true }

fun main() {
    val bootstrap  = System.getenv("KAFKA_BOOTSTRAP")   ?: "localhost:9092"
    val topic      = System.getenv("KAFKA_TOPIC_ARC_EVENTS") ?: "arc-events"
    val bqProject  = System.getenv("GCP_PROJECT_ID")    ?: error("GCP_PROJECT_ID is required")
    val bqDataset  = System.getenv("BQ_DATASET")        ?: "overdue"
    val flushEvery = System.getenv("FLUSH_EVERY")?.toIntOrNull() ?: 100

    val bq = BigQueryOptions.newBuilder().setProjectId(bqProject).build().service
    val tableId = TableId.of(bqDataset, "book_arcs")

    val consumer = KafkaConsumer<String, String>(consumerProps(bootstrap)).also {
        it.subscribe(listOf(topic))
    }

    log.info { "Stream processor ready. Consuming '$topic' → $bqProject.$bqDataset.book_arcs" }

    val buffer = mutableListOf<Map<String, Any?>>()

    Runtime.getRuntime().addShutdownHook(Thread {
        log.info { "Shutdown — flushing ${buffer.size} buffered rows..." }
        if (buffer.isNotEmpty()) flush(bq, tableId, buffer)
        consumer.close()
    })

    while (true) {
        val records = consumer.poll(Duration.ofSeconds(5))

        for (record in records) {
            val event = runCatching {
                json.decodeFromString<JsonObject>(record.value())
            }.getOrElse { e ->
                log.error { "Failed to parse message: ${e.message}" }
                continue
            }

            buffer.add(toRow(event))

            if (buffer.size >= flushEvery) {
                flush(bq, tableId, buffer)
                buffer.clear()
                consumer.commitSync()
            }
        }

        // Flush on idle (no new messages came in during the poll window)
        if (records.isEmpty && buffer.isNotEmpty()) {
            flush(bq, tableId, buffer)
            buffer.clear()
            consumer.commitSync()
        }
    }
}

fun toRow(event: JsonObject): Map<String, Any?> {
    fun str(key: String) = event[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
    fun dbl(key: String) = str(key)?.toDoubleOrNull()
    fun int(key: String) = str(key)?.toIntOrNull()

    return mapOf(
        "book_id"             to str("book_id"),
        "chunk_index"         to int("chunk_index"),
        "position_pct"        to dbl("position_pct"),
        "chapter"             to str("chapter"),
        "word_count"          to int("word_count"),
        "sentiment_score"     to dbl("sentiment_score"),
        "tension_score"       to dbl("tension_score"),
        "pacing_score"        to dbl("pacing_score"),
        "conflict_density"    to dbl("conflict_density"),
        "dominant_characters" to event["dominant_characters"]
            ?.jsonArray
            ?.map { it.jsonPrimitive.content },
    )
}

fun flush(
    bq: com.google.cloud.bigquery.BigQuery,
    tableId: TableId,
    rows: List<Map<String, Any?>>,
) {
    val request = InsertAllRequest.newBuilder(tableId)
        .apply { rows.forEach { addRow(it) } }
        .build()

    val response = bq.insertAll(request)

    if (response.hasErrors()) {
        response.insertErrors.forEach { (index, errors) ->
            log.error { "Row $index errors: $errors" }
        }
    } else {
        log.info { "Flushed ${rows.size} rows → ${tableId.dataset}.${tableId.table}" }
    }
}

fun consumerProps(bootstrap: String) = Properties().apply {
    put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap)
    put(ConsumerConfig.GROUP_ID_CONFIG, "stream-processor")
    put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest")
    put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false")
    put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer::class.java.name)
    put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer::class.java.name)
    put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "100")
}
