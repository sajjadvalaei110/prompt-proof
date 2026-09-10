# Stable-graph fixture (74 types across 6 packages)

Java source fixture for the R6 stable-map browser regressions
(`scripts/verify_stable_graph_pipeline.py` → `scripts/verify-stable-graph-ui.mjs`).

The existing 17-class `spring-project` fixture cannot exercise the 36 → 12 display-limit
regression, because the Classes page needs more than 36 in-scope types before two **Show more**
actions can reveal 36. This fixture is sized for that and for later layout work.

Source is read-only test data. The runner copies it to a temporary directory, imports that copy,
and hashes the tree before and after to prove analysis never writes to it.

## Shape

| Package | Types | Purpose |
|---|---|---|
| `com.example.stable.controller` | 10 | HTTP entry points; each injects one service |
| `com.example.stable.service` | 24 | A→B→C chain, reciprocal pair, ambiguous injections, fan-in |
| `com.example.stable.domain` | 14 | Entities, including a three-node cycle and isolated types |
| `com.example.stable.repository` | 10 | Fan-in sinks shared by several services |
| `com.example.stable.util` | 10 | Deliberately disconnected: zero relationships |
| `com.example.stable.external` | 6 | Unresolved external supertypes and injections |

## Topology features, as actually produced by the parser

Verified against the imported graph, not assumed from the source text:

| Feature | Where | Observed |
|---|---|---|
| Visible A→B→C chain | `OrderController` → `OrderService` → `PricingService` → `TaxService` | present at CLASS level |
| Reciprocal pair | `PaymentService` ⇄ `FraudService` | both directions present |
| Cycle | `Order` → `Item` → `Customer` → `Order` | present at CLASS level via `CALLS` |
| Disconnected types | all of `util`, plus `Address`, `Money`, `Product`, `Category`, `Discount`, `Invoice`, `Payment`, … | 21 types with degree 0 |
| Parallel relationship kinds | e.g. `OrderService` → `OrderRepository` | `INJECTS` + `CALLS` + `DEPENDS_ON` between the same pair |
| Fan-in sink | `OrderRepository` | `OrderService`, `ReportService`, `SearchService`, `ArchiveService` |
| `CANDIDATE` resolution | `NotificationService` → `NotificationChannel`, `CarrierRouter` → `ShipmentCarrier` | 4 dashed edges (two unqualified `@Component` implementations each) |
| `UNRESOLVED` resolution | `external` supertypes/credential injections, plus JDK calls | 23 relationships, **metadata only** — see below |

Counts observed on import: 74 types (72 `CLASS`, 2 `INTERFACE`), 6 packages, 112 edges
(`INJECTS` 45, `CALLS` 32, `DEPENDS_ON` 31, `IMPLEMENTS` 4), 108 `RESOLVED` + 4 `CANDIDATE`.

## Limits of this fixture

- **The 23 unresolved relationships are 6 `EXTENDS` (`GatewayBase`, `ShippingBase`, `TaxBase`,
  `MailBase`, `AnalyticsBase`, `SearchBase`), 6 `INJECTS` (the matching `*Credentials` types) and
  11 `CALLS` on library types the source does not index (`value.length()` in the `util` classes and
  one chained call in `FraudService`).** The `CALLS` group is incidental: any call on a JDK type is
  unresolved here, so this count is not a stable assertion target.
- **Unresolved relationships never reach the canvas.** `GraphQueryService` selects edges
  `WHERE r.target_symbol_id IS NOT NULL`, so an edge whose target is outside the indexed source is
  reported in `metadata.unresolvedRelationships` and the footer's "unresolved external targets"
  count, never as a drawn route. `projectGraph()` also skips `!e.targetId`. The only non-`RESOLVED`
  resolution state that can be *drawn* is `CANDIDATE`.
- **Self-loops are not drawn below METHOD level.** `projectGraph()` drops `source === target` for
  PACKAGE and CLASS levels, so a cycle contained in one package is invisible at PACKAGE level. The
  `Order`/`Item`/`Customer` cycle therefore only exercises the CLASS level.
- **`USES_TYPE`, `EXTENDS`, `READS_FIELD`, `WRITES_FIELD`, `HANDLES_ROUTE` and `DECLARES_BEAN`
  are not produced here.** Plain field declarations do not create relationships in this parser;
  the fixture uses method calls and `@Autowired` injections instead.
- Layout cases the source parser cannot reliably produce — a guaranteed avoidable edge crossing,
  collinear route overlap, a self-loop next to another card, mixed card dimensions — belong in
  separate **pure** layout fixtures (Step 6), not here.

## Regenerating

These sources are plain files in the working tree, emitted once by a throwaway generator that was
not kept. There is nothing to re-run: edit a file by hand when the fixture needs to change, keep the
topology table above true against a fresh import, and re-run
`python3 scripts/verify_stable_graph_pipeline.py baseline` afterwards.
