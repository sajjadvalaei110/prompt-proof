# Code Atlas

Code Atlas is a local, privacy-first Java and Spring code understanding tool that combines deterministic static analysis with local LLM explanations to help developers explore unfamiliar codebases with navigable source evidence and honest uncertainty.

## Prerequisites

- **Java**: JDK 21+
- **Node.js**: Node 22+
- **npm**: npm 9+

## Quick Start

1. **Start the backend**:
   ```bash
   ./gradlew bootRun
   ```
   The backend API will start at `http://127.0.0.1:8085`.

2. **Start the frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   The development server will run at `http://localhost:5173`.

## Configuration

- **Backend Overrides**: Create `src/main/resources/application-local.yml` or export standard Spring environment variables (e.g., `SERVER_PORT=8085`) to override local defaults.
- **Model Settings**: Configure your local inference endpoint, model ID, and context budgets dynamically through the web Settings UI or via `/api/model-profile`.

## Local Model Setup

Code Atlas uses an OpenAI-compatible HTTP endpoint for local model inference. No code is sent to the cloud.
- **LM Studio**: Start the local server (default: `http://localhost:1234/v1`), load your preferred model (e.g., Qwen 2.5 Coder, DeepSeek Coder), and set the model ID in the Code Atlas Settings UI.
- **Ollama**: Run `ollama serve` (default: `http://localhost:11434/v1`), pull your model (e.g., `ollama run qwen2.5-coder`), and configure the endpoint in Settings.
- **Offline Mode**: Graph browsing, AST symbol extraction, and source navigation work entirely offline even if no local model server is running.

## Architecture

Code Atlas is structured as a modular monolith:
- **Backend**: Spring Boot 3.4.3 application handling workspace discovery, AST symbol solving via JavaParser, relationship extraction, SQLite snapshot persistence, and model client orchestration.
- **Frontend**: React 19 single-page application using Cytoscape.js for interactive dependency graph visualization and Monaco editor for source exploration.
- **Storage**: Embedded SQLite with WAL mode and Flyway versioned migrations.

See [docs/ARCHITECTURE.md](file:///home/sajjad/projects/review-assist/docs/ARCHITECTURE.md) for module boundaries, data flow, and key design decisions.

## Supported Scope

- **Supported**: Java source code analysis (classes, interfaces, enums, records, method overloads, generics, inheritance, constructor injection).
- **Heuristic**: Spring annotations (`@Service`, `@Repository`, `@RestController`, `@Component`, `@Qualifier`, `@Bean`, `@Profile`).
- **Unsupported**: Kotlin, Groovy, Lombok bytecode transformations, runtime annotation processor evaluation, and dynamic reflection-based registrations. Source repositories are treated as read-only data and never compiled or executed during import.
