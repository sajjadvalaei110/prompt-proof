plugins {
    java
    id("org.springframework.boot") version "3.4.3"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "dev.codeatlas"
version = "0.1.0-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // Spring Boot
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")

    // JavaParser with symbol solver
    implementation("com.github.javaparser:javaparser-symbol-solver-core:3.26.4")

    // SQLite
    implementation("org.xerial:sqlite-jdbc:3.49.1.0")

    // Flyway for migrations
    implementation("org.flywaydb:flyway-core")

    // Jackson for JSON
    implementation("com.fasterxml.jackson.core:jackson-databind")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.withType<Test> {
    useJUnitPlatform()
}

// Task to copy frontend build into backend resources for packaging
tasks.register<Copy>("copyFrontend") {
    from("frontend/dist")
    into(layout.buildDirectory.dir("resources/main/static"))
    dependsOn(":npmBuild")
}

tasks.register<Exec>("npmBuild") {
    workingDir = file("frontend")
    commandLine("npm", "run", "build")
    // Only run if frontend exists and has been installed
    onlyIf { file("frontend/node_modules").exists() }
}

tasks.named("processResources") {
    dependsOn("copyFrontend")
}

