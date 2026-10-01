# scip-java indexer (ADR 0012) — verification evidence

Packaged app (`./gradlew bootJar`, `build/libs/code-atlas-0.1.0-SNAPSHOT.jar`) with an isolated data dir and
`--codeatlas.indexers.scip-java.home=data/tools/scip-java` (installed by `./gradlew installScipJava`), driven by
playwright-core against the preinstalled Chromium. The workspace was `test-fixtures/scip-gradle-project/app`
(a module; the Gradle build root is the fixture directory). All screenshots were opened and inspected.

| File | Shows |
|---|---|
| `1-import-default-javaparser.png` | Default import: Indexer picker on `JavaParser (source only)`, no consent box, source-only footnote. |
| `2-scip-selected-consent-required.png` | `scip-java` chosen: consent checkbox appears, Analyze disabled, footnote explains private copy + offline-first cache reuse. |
| `3-consent-given.png` | Consent ticked (checkbox inline with its text), Analyze enabled. |
| `4-scip-java-graph.png` | Result after ~11 s: the `app` package with its 2 classes; one analysis warning (the "indexed its app directory" module note). |
| `5-import-narrow-scip.png` | 390 px wide: fields stacked, consent above the button, `scrollWidth` 390 (no horizontal scroll). |

Recorded outcomes of the same run (`run.mjs` report):

- Indexer options `javaparser` (default) and `scip-java`; consent visible only for scip-java; Analyze disabled until ticked.
- Analysis completed in 11–12 s; **Re-analyze source** on the scip-java workspace sent `{path, language}` only
  (keeps the recorded engine and consent), completed with no error banner, workspace still `indexer: scip-java`.
- Go to definition on the live snapshot: `greetAll` call in `Main.java` → `found` in `GreetingService.java` line 11;
  local `service` → its declaration (`GreetingService service`, no graph symbol); `greeter.greet` into the sibling
  `core` module → `external`.
- Fixture tree hash identical before/after; `indexer-work/` empty after each run; app log shows each run started
  `(offline)` with the machine's Gradle cache.
- Tool missing (`home` and `command` pointed nowhere): the `scip-java` option is `disabled`, labelled
  "— not installed", with the `./gradlew installScipJava` instruction as its title (checked in the DOM; a closed
  `<select>` cannot show it in a screenshot, so none is kept).

`python3 scripts/verify_language_import_pipeline.py` (existing gate, same jar): PASS — language picker, default
JavaParser import, re-analysis and recent-project flows unchanged.
