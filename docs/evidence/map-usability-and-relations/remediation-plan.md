# Review remediation — map usability and relationship coverage

Source review: `map-usability-and-relations-review.md` (32 findings, against the uncommitted changes on `e4de44c`).
Each finding was re-checked against the code **before** acting; where possible the defect was first reproduced by a
failing test or browser check, then fixed, then the same check was re-run. Verdicts: **fixed**, **fixed differently**
(real defect, different fix than suggested), **not a defect**.

Checks referenced below:
- `RET` — `src/test/java/dev/codeatlas/analysis/RelationshipEdgeCasesTest.java` (new). 9 of its first 9 tests failed
  before the analyzer fixes; the later rollback and response-cap tests were added with their fixes, and the
  catch/pattern and rollback checks were confirmed by mutation (removing the fix makes them fail).
- `REX` — `RelationshipExtractionTest` (microservice-java).
- `NCT` — `scripts/test-node-card.mjs` (new). Failed on the old `nodeCard.ts` for #14, #26, #32.
- `BC` — `remediation/browser-check.mjs`, Chromium CDP against an isolated backend; report `remediation/browser-report.json` (16/16).

| # | Verdict | Verified need | Change | Verified by |
|---|---|---|---|---|
| 1 | fixed | `Clash.java` (`Clash()` + `void Clash()`) was excluded with a UNIQUE violation. Scope is one file (AnalysisService catches per file), so "aborts indexing" overstates it. | Constructor key is `Type.<init>(..)` only when the type declares a method with the identical name and parameters; normal constructor names stay readable. | RET `methodNamedLikeItsType…` |
| 2 | fixed | `Circle extends Base implements Shape` had EXTENDS/IMPLEMENTS but no DEPENDS_ON. | `supertype()` records EXTENDS/IMPLEMENTS and DEPENDS_ON on the same evidence. microservice-java and large-project counts unchanged (no indexed supertypes). | RET `inheritanceIsSummarized…`, REX, benchmark |
| 3 | fixed | Two local `class Helper {}` excluded `UsesLocal.java`, and its partial rows then excluded the real `Helper.java`. | `parseDeclarations` skips types without a qualified name. | RET `localClassesAreNotIndexed…` |
| 4 | fixed | Compact constructor not indexed. Found while verifying: the symbol solver cannot resolve **any** record constructor ("Symbol resolution not configured"). | Index compact constructors keyed by record components; attribute their bodies; `new R(..)` targets the declared canonical constructor when no other constructor has that arity or is varargs (deterministic, not a guess). | RET `recordCompactConstructor…` |
| 5 | fixed differently | Confirmed: `EventNotFoundException::new` targets the type although the class declares a constructor; JavaParser cannot resolve `T::new`. | Javadoc and SUPPORT_MATRIX now state `T::new` targets the type (no heuristic, keeping "never guess"). Self `T::new` edges skipped. | doc review; REX line 78 |
| 6 | fixed | For ordinary type references the symbol solver already resolves static member-type imports (first test passed). The defect is real for names resolved only by lookup: annotations (`import static a.Outer.Tag; @Tag`) resolved to same-package `b.Tag`. | Single-static and static on-demand imports participate; a static import that is not an indexed type does not short-circuit. | RET `singleStaticImport…` |
| 7 | fixed | Catch parameter / pattern variable named like an indexed type produced a false DEPENDS_ON. Found while verifying: the symbol solver itself reports the same-named **type** when a variable's declared type is unresolvable, so `calculateResolvedType` was the main path. | `receiverType` rejects that solver fallback (declared type unresolvable and resolved simple name == variable name); `isValue` recognizes catch parameters and earlier pattern variables. Inherited fields remain invisible (documented). | RET `catchParametersAndPatternVariables…` (+ mutation) |
| 8 | fixed differently | Six `findAll` passes per type, repeated per nesting level. Thread sampling on `clients` showed 8/10 relationship-pass samples in SQLite `step` (autocommit inserts), so traversal was not the dominant cost — see #10. | One pre-order walk per file buckets nodes by enclosing type (identity map); extraction logic and order unchanged. | full suite; counts unchanged |
| 9 | fixed | `int Level` in the `if` branch hid `Level.LOW` in the `else` branch. | Only statements before the expression in each enclosing block (plus for/for-each/try-resource/catch headers) count; linear, no subtree scans. | RET `aLocalInAnotherBranch…` |
| 10 | fixed | (a) `content.split` per evidence site; (b) relationship source API returned every evidence row, each with the whole file; (c) per-row autocommit dominated extraction time. | (a) split once per file; (b) rows bounded by `codeatlas.explanations.evidence-occurrences` (12, as ContextBuilder), ordered by path/line, `totalSites` added (additive field), dialog says "Showing the first N of M"; live file re-hash once per file; (c) one transaction per file in the declaration and relationship passes (a failed file now leaves no partial rows). `clients`: 34 s → 17 s on the same loaded machine, same symbol count. | RET `relationshipSourceResponseIsBounded…`, `aFileThatFailsDeclarationIndexing…` (+ mutation); clients timing |
| 11 | fixed | Both analysis tests used `./data/codeatlas.db`. | `@DynamicPropertySource` temp data dir (pattern from DeveloperWorkflowTest); runs of these classes (and the new RET) leave `./data/codeatlas.db` untouched (mtime checked). A full `./gradlew test` still writes it through five pre-existing, unisolated `@SpringBootTest` classes outside this review (listed in PROJECT_STATUS). | stat before/after |
| 12 | fixed | Confirmed in Cytoscape: an edge's `closedNeighborhood()` is only the edge. | Neighborhood = `closedNeighborhood() ∪ connectedNodes()` (node inspection unchanged). | BC #12 + screenshot |
| 13 | fixed | DOM buttons over the corner took right-click (native menu), drag and double-click. | Map buttons are visual + keyboard only (`pointer-events: none`); the canvas hit-tests the square on tap to open code, highlights it on hover; drag, right-click, double-click and marquee on the corner act on the card. | BC: element under square is canvas; click opens code without inspecting; right-click opens card menu; drag moves card; Enter on focused button opens code |
| 14 | fixed | 11 CJK glyphs (330 px) were fitted into a 218 px line. | Full-width glyphs 1.0 em; Unicode uppercase 0.7 em. | NCT |
| 15 | fixed | `static final Singleton INSTANCE = new Singleton()` produced a self CONSTRUCTS edge. | Skip CONSTRUCTS when source == target. | RET `noSelfEdges…` |
| 16 | fixed | `a.Status.CODE` (`a` a parameter) linked to package `edge.a`'s `Status`. | `isValue` checks the root name of a qualified chain. | RET `aQualifiedNameRootedInAValue…` |
| 17 | not a defect | JLS 6.4.1: on-demand imports (including implicit `java.lang.*`) never shadow each other, so a simple name provided by two of them does not compile. A unique indexed match is therefore correct; a hardcoded JDK list would add a heuristic. | Rationale recorded in `typeNamed` Javadoc. | reasoning |
| 18 | fixed | Caches retained until the next run. | `AnalysisService` calls `releaseRunCaches()` in `finally`. | code review |
| 19 | fixed | USES_TYPE duplicates would pass. | Per-pair uniqueness assertion (REX and RET). | tests |
| 20 | fixed | Membership effect keyed on edge IDs. | Keyed on card IDs. | BC: filter change with same cards keeps the menu open |
| 21 | fixed (defensive) | Not reachable today (`multiIds` only holds on-canvas IDs); order dependency was fragile. | Class-sync effect moved after reconciliation. | tsc, BC |
| 22 | fixed differently | Browser full screen consumes Escape; the page cannot sequence "clear selection first". | Comment corrected: Escape clears selection or leaves the overlay; in browser full screen the browser exits first and the selection is kept. | code review (headless cannot enter real full screen) |
| 23 | fixed | ≈417 px needed below 760 px. | Fit map / Full screen become icon-only below 760 px (aria-labels kept). | BC at 360/375/390/420 px |
| 24 | fixed | Verified narrower than reported: related rows were already clipped (a flex item with `overflow: hidden` can shrink), but the "Belongs to" name was a bare text node that overflowed the panel (inspector `scrollWidth` 408 > 328 with a long name). | Parent name wrapped in a span; row text `min-width: 0; overflow-wrap: anywhere` so full identifiers wrap instead of being clipped mid-word. | BC before/after measurement + screenshots |
| 25 | fixed | Method card "Remove from scope" removed its whole class silently. | App computes what leaves scope (`planScopeRemoval`, shared with the removal itself); menu and selection bar say "Remove class EventService from scope" with an explanatory title. Class/package cards keep the plain label. | BC + screenshot |
| 26 | fixed | `КонтроллерСобытий` was cut mid-word. | Unicode property escapes for the camelCase boundary. | NCT |
| 27 | fixed | Context reboot + analysis 6×. | `@TestInstance(PER_CLASS)` + `@BeforeAll`, no `@DirtiesContext`. | test time |
| 28 | fixed | Fresh `[]` each frame when zoomed out. | Keep the previous empty array. | tsc |
| 29 | fixed | `find(...)!` on tap. | Guarded. | tsc |
| 30 | fixed | Drag loop without `inside()`. | Guarded. | tsc |
| 31 | fixed by #13 | Tooltip correctly has `pointer-events: none`; the click reached a DOM button under it. Buttons no longer take pointer events, so the canvas resolves the click. | none beyond #13 | BC #13 |
| 32 | fixed | `_verylongprivatemethodname` → `['_', 'verylongpriv…']`. | Leading separators are not break points. | NCT |
