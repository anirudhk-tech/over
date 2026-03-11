plugins {
    kotlin("jvm") version "2.0.0"
    kotlin("plugin.serialization") version "2.0.0"
    application
}

group = "dev.overdue"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.apache.kafka:kafka-clients:3.9.0")
    implementation("com.google.cloud:google-cloud-bigquery:2.42.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("ch.qos.logback:logback-classic:1.5.12")
    implementation("io.github.oshai:kotlin-logging-jvm:7.0.0")
}

application {
    mainClass.set("dev.overdue.processor.MainKt")
}

kotlin {
    jvmToolchain(21)
}
