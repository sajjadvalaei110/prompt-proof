# ADR 0001: Technology Stack Selection

- **Status**: Accepted
- **Date**: 2026-09-07

## Context

Code Atlas is a local, privacy-first developer tool for understanding Java and Spring applications. The core product requirements mandate:
1. Pure local execution: zero telemetry, zero mandatory cloud dependencies, and running directly on developer machines.
2. Source-only analysis: target repositories must be parsed safely without executing untrusted Gradle builds, compilers, or annotation processors.
3. Interactive visual graph navigation: smooth rendering of classes, methods, and call paths up to hundreds of nodes.
4. Robust local persistence: atomic snapshot management, strict evidence traceability, and recovery across restarts.

## Decision

We have selected the following core technology stack:

- **Backend Runtime & Framework**: **Spring Boot 3.4.3** on **Java 21**.
  - Provides a proven, modular foundation for REST/SSE APIs, task scheduling, and configuration management.
  - Targets Java 21 LTS features (records, pattern matching, virtual threads).
- **Source Analysis**: **JavaParser 3.26.4** (with `javaparser-symbol-solver-core`).
  - Pure Java AST parsing and symbol resolution that runs entirely in-process without requiring external compiler daemons or running target build scripts.
  - Provides exact token line/column positions required by the evidence model.
- **Persistence**: **SQLite 3** (`sqlite-jdbc:3.49.1.0`) with **Flyway** (`flyway-core`).
  - Embedded zero-configuration single-file database.
  - Configured with Write-Ahead Logging (WAL), busy timeout, and connection-level foreign key enforcement (`PRAGMA foreign_keys = ON`).
  - Ordered, checksummed Flyway migrations ensure reproducible schemas.
- **Frontend**: **React 19**, **TypeScript 5.7**, and **Vite 6**.
  - Fast, modern web application stack providing responsive UI components and developer tooling.
- **Graph Visualization**: **Cytoscape.js 3.30.4** with **`cytoscape-dagre`**.
  - High-performance canvas-based graph engine capable of handling hundreds of nodes and edges smoothly.
  - Built-in hierarchical layout support and rich hit-testing for interactive tooltips and selection.

## Consequences

- **Spring Boot 3.4.x vs. 4.x**: While Spring Boot 4.x development is ongoing in the broader ecosystem, we standardize on Spring Boot 3.4.3 for production stability, broad third-party library compatibility, and verified Flyway/SQLite integration. Upgrading to future major releases will be evaluated once ecosystem dependencies mature.
- **Source-Only Trade-off**: Relying on JavaParser without executing annotation processors means Lombok-generated methods and runtime reflection cannot be resolved. This is an intentional security and stability boundary that prevents untrusted target code execution.
- **SQLite Concurrency**: SQLite's single-writer architecture requires that write operations (snapshot indexing) remain bounded and isolated from long-running local LLM requests, which must execute outside database transactions.

## Alternatives Considered

- **Source Parsers**:
  - *Tree-sitter*: Highly efficient for syntax highlighting and broad language support, but lacks an integrated Java symbol solver for method overload and type resolution.
  - *Eclipse JDT / Spoon*: High memory overhead and complex dependency footprints, often pulling in IDE runtime baggage.
- **Storage**:
  - *Embedded Neo4j*: Excessive JVM memory footprint and operational complexity for local desktop workflows; neighborhood traversals are efficiently serviced by relational indexing at this scale.
  - *H2 Database*: Pure Java, but historically prone to subtle concurrency issues and less mature WAL behavior compared to SQLite.
  - *DuckDB*: Optimized for columnar analytics rather than transactional snapshot integrity and relational foreign key constraints.
- **Graph Libraries**:
  - *React Flow*: High developer ergonomics with HTML-based nodes, but encounters performance degradation when rendering large graphs (100+ complex nodes) compared to Cytoscape's hardware-accelerated canvas.
  - *D3.js*: Maximum rendering flexibility, but requires extensive custom development for graph layouts, pan/zoom viewports, and edge hitboxes.
