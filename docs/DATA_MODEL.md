# Code Atlas — Data Model

## 1. Entity Overview

The Code Atlas persistence layer is implemented in SQLite using Flyway versioned migrations. The core entities and their responsibilities include:

| Entity | Identity and Responsibility |
|---|---|
| **Workspace** | UUID primary key, canonical filesystem root path, active snapshot reference (`active_snapshot_id`), and inclusion/exclusion settings. |
| **Logical Subject** | Stable, workspace-scoped logical key for a type, callable, or relationship (e.g., `com.example.OrderService#placeOrder(Order)`). Enables notes and navigation across snapshots. |
| **Symbol Version** | Snapshot-scoped occurrence of a symbol. Unique on `(snapshot_id, logical_symbol_key)`. Stores package, name, kind (class, interface, method, etc.), visibility, signature, and module identity. |
| **Relationship Occurrence** | Snapshot-scoped row linking source and target `symbol_version` rows. Captures kind (`calls`, `injects`, `implements`, `extends`), call-site location, and resolution status (`resolved`, `candidate`, `unresolved`). |
| **Source File Version** | Snapshot-scoped record of an analyzed file. Stores relative path, content hash (SHA-256), character encoding, and line count. |
| **Evidence** | Precise source range linked to a `file_version_id`. Stores 1-indexed start/end line, column coordinates, and character offsets. |
| **Explanation** | AI-generated explanation for a subject version. Captures model provenance, prompt/schema versions, generation options, and validated structured claims. |
| **Job / Job Item** | Tracks background tasks (indexing, bulk explanation). Includes status (`pending`, `running`, `completed`, `failed`, `cancelled`), attempt count, progress counters, and error diagnostics. |
| **Note / Bookmark** | User annotations attached to a workspace and logical subject key. Supports an orphaned/relink state if the subject is removed or renamed in subsequent snapshots. |

---

## 2. Identity Rules

To balance navigation continuity with snapshot immutability, Code Atlas separates logical keys from physical snapshot versions:

- **Workspace-Scoped Logical Keys**:
  - Uniquely identify code elements across time (e.g., `type:com.example.OrderService`, `method:com.example.OrderService#save(Order)`).
  - Used for user bookmarks, notes, and stable search bookmarks.
  - Survive re-indexing when code symbols remain unchanged between snapshots.

- **Snapshot-Scoped Physical Versions**:
  - Primary keys in `symbol_version` and `relationship_occurrence` are scoped to a specific `snapshot_id`.
  - Enforced via composite foreign keys (e.g., foreign keys on relationships require `(source_symbol_id, snapshot_id)` and `(target_symbol_id, snapshot_id)` to match the parent snapshot).
  - Overloaded methods have distinct logical keys that incorporate their parameter type signatures.

---

## 3. Snapshot Lifecycle

Snapshots ensure complete data consistency during indexing operations:

```
[Create Staging Snapshot] ──> [Parse & Index] ──> [Consistency Check]
                                                         │
                             ┌───────────────────────────┴───────────────────────────┐
                             ▼                                                       ▼
                [Publish Snapshot (Atomic)]                                [Mark Snapshot Failed]
               active_snapshot_id updated                               Previous snapshot preserved
```

1. **Staging**: When an indexing job starts, a new snapshot record is inserted with status `staging`. All extracted files, symbols, relationships, and evidence rows are written against this staging ID.
2. **Atomic Publication**: Once analysis completes and integrity checks succeed, the snapshot status is updated to `published`, and `workspace.active_snapshot_id` is updated in a single transaction.
3. **Failure Isolation**: If an indexing job fails or is cancelled, the staging snapshot is marked `failed` or discarded. The previous published active snapshot remains untouched.
4. **Stale Retention**: Prior published snapshots may be retained for comparison or diff analysis; late-arriving AI explanation tasks remain bound to the snapshot ID for which they were generated.

---

## 4. Evidence Model

Every relationship and verifiable claim points to source evidence:

- **Coordinates**:
  - `file_version_id`: Foreign key referencing the exact file snapshot.
  - `start_line` / `start_column`: 1-indexed start location.
  - `end_line` / `end_column`: 1-indexed end location.
  - `start_offset` / `end_offset`: 0-indexed character offsets for direct editor cursor positioning.
- **Text & Encoding**:
  - Line ending normalization (LF vs. CRLF) is handled when computing character offsets.
  - Retained source or filesystem reads verify content hashes (SHA-256) before displaying source highlights to detect external tampering.

---

## 5. Explanation Provenance

Explanations produced by local language models record complete provenance for reproducibility and auditability:

- **Provenance Metadata**:
  - `model_id`: The exact model identifier reported by the inference engine (e.g., `qwen2.5-coder-7b-instruct`).
  - `provider_base_url`: Host/port of the model endpoint.
  - `prompt_version`: Version identifier of the prompt template used.
  - `schema_version`: Version of the JSON response schema (`explanation-schema.json`).
  - `context_hash`: Hash of the source evidence and neighborhood facts supplied in the context window.
  - `freshness_timestamp`: Time of generation.

- **Structured Content Schema**:
  ```json
  {
    "schemaVersion": "1",
    "subjectVersionId": "sym-ver-1024",
    "shortLabel": "Persists order transaction",
    "hoverSummary": "Validates payment before delegating order persistence to OrderRepository.",
    "claims": [
      {
        "text": "Invokes OrderRepository.save() on line 45.",
        "basis": "source_fact",
        "evidenceIds": ["ev-12"]
      },
      {
        "text": "Acts as the transactional boundary for checkout.",
        "basis": "inferred_purpose",
        "evidenceIds": ["ev-12", "ev-15"]
      }
    ],
    "unknowns": [
      "Cannot determine rollback rules without reviewing configuration."
    ]
  }
  ```
  - **`source_fact`**: Directly observable in source code and backed by evidence IDs.
  - **`inferred_purpose`**: Probabilistic hypothesis of developer intent.
  - **`unknown`**: Explicit limitations where context is insufficient.

## 6. Hierarchical generation schema (V004)

| Record/field | Contract |
| --- | --- |
| `explanation_syntheses` | Immutable synthesis inputs/provenance, snapshot, schema/prompt version, endpoint/model, SHA-256 fingerprint and retained evidence; freshness can change from READY to STALE. |
| `class_pre_explanations` | One current draft purpose per class, linked to the synthesis that produced it. These records are never full READY explanations. |
| `explanations.context_dependencies` | JSON list of consumed generated inputs (`symbolId`, `kind` = full/pre, `version` hash). Current context evidence retains the actual text used, including prior output provenance. |
| `jobs.synthesis_status` | PENDING → RUNNING → READY, or FAILED. Cancellation is still represented by the job's status. A document edit can restore the barrier to PENDING. |
| `explanation_queue.relation_count`, `loc` | Persisted deterministic ordering. Missing declaration spans use 2147483647. Symbol ID breaks remaining ties. |

The version-1 synthesis response contract is in
[`prompts/architecture-synthesis-schema.json`](../prompts/architecture-synthesis-schema.json).
The service adds snapshot membership and exact CLASS coverage validation. Full
explanations now record prompt version `3.1`; successful earlier prompt versions
are preserved and can be explicitly refreshed.

Additive API fields: graph edges expose `explanationStatus`; explanation responses
can include `preExplanation { businessLogic, status: DRAFT|STALE, provenance }`;
queue status exposes `synthesisStatus` and `errorMessage`. Consumers must not equate
DRAFT with READY. A grouped edge is READY only when all occurrences are READY.

## 7. Resumable architecture stages (V005)

`architecture_checkpoints` has primary key `(snapshot_id, stage_key)` and retains
`stage_kind` (context/classes), `prompt_version`, `model_id`, `provider_base_url`,
exact `input_context`, validated `output_json`, and `generated_at`. Keys include
original-input/profile identity and the actual stage prompt/output allowance.
Checkpoint records alone never imply READY draft or full-explanation coverage.
Final synthesis evidence includes references to all consumed stage keys.

`jobs.synthesis_stage` and `jobs.synthesis_completed` expose the exact class range
or context batch currently in flight and the number of validated stages
reused/generated in that attempt. The workspace queue-status response adds
`synthesisStage`, `synthesisCompleted`, and `synthesisStageStartedAt` (the current
job update time in UTC). This lets the UI show elapsed request time without
claiming incomplete work has been saved.
There is no fixed total because truncation/context rejection can split batches.
The architecture response schema remains version 1; the synthesis prompt remains
version 2.0 and the resumable planning pipeline is version 2.1. V004 is unchanged,
allowing existing databases to migrate cleanly.
