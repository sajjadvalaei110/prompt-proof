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
    if (name == "test") exclude("**/BoundedExplanationScaleTest.class")
}

tasks.register<Test>("constrainedMemoryTest") {
    description = "Runs the 10k/50k/100k explanation fixture with a 256 MiB test heap."
    group = "verification"
    useJUnitPlatform()
    include("**/BoundedExplanationScaleTest.class")
    maxHeapSize = "256m"
    jvmArgs("-XX:+HeapDumpOnOutOfMemoryError")
    shouldRunAfter(tasks.test)
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

// scip-java (ADR 0012): an optional second Java indexer, run as a separate tool rather than bundled into the
// application (it is ~120 MB of Scala/Kotlin tooling). `./gradlew installScipJava` resolves the pinned version
// through this build's own Gradle cache, so nothing already downloaded is downloaded again, and syncs the jars into
// data/tools/scip-java/lib (the default codeatlas.indexers.scip-java.home), or -PscipJavaHome=<dir>.
val scipJavaVersion = "0.12.3"
val scipJava by configurations.creating {
    isCanBeConsumed = false
    // The Spring dependency-management plugin applies Boot's BOM to every configuration, which would silently
    // swap scip-java's own Kotlin/slf4j/commons versions. Keep what scip-java was published and tested with.
    resolutionStrategy.eachDependency { useVersion(requested.version ?: return@eachDependency) }
    attributes {
        attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage.JAVA_RUNTIME))
        attribute(TargetJvmEnvironment.TARGET_JVM_ENVIRONMENT_ATTRIBUTE, objects.named(TargetJvmEnvironment.STANDARD_JVM))
        attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.LIBRARY))
    }
}
dependencies {
    scipJava("com.sourcegraph:scip-java_2.13:$scipJavaVersion")
}
tasks.register<Sync>("installScipJava") {
    description = "Installs the scip-java indexer (ADR 0012) for the scip-java Java engine."
    group = "code atlas"
    from(scipJava)
    into(file(providers.gradleProperty("scipJavaHome").getOrElse("data/tools/scip-java")).resolve("lib"))
}
