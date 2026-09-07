# Code Atlas — Construct Support Matrix

This document defines the static analysis support status for Java language constructs, Spring framework annotations, and ecosystem tooling in Code Atlas.

## Support Status Categories

- **Supported**: Completely extracted, resolved, and verified with deterministic code facts.
- **Heuristic**: Recognized via static pattern matching without dynamic runtime container evaluation.
- **Detected (Uncertain)**: Extracted from AST syntax, but runtime evaluation is required for deterministic resolution; displayed with explicit uncertainty.
- **Unsupported**: Deliberately out of scope or not processed by source-only analysis.

---

## Construct Support Matrix

| Construct | Status | Notes |
|---|---|---|
| `class` | **Supported** | Standard Java classes, abstract classes, inner classes, and static nested classes. |
| `interface` | **Supported** | Interfaces, default methods, static methods, and interface inheritance. |
| `enum` | **Supported** | Enumeration types, enum constants, and custom enum methods. |
| `record` | **Supported** | Java records, canonical constructors, compact constructors, and component accessors. |
| Method overloads | **Supported** | Disambiguated using full parameter type signatures in logical symbol keys. |
| Generics | **Supported** | Type parameters, bounds, and parameterized return/field types parsed from AST. |
| Inheritance | **Supported** | `extends` and `implements` hierarchies fully extracted and navigable in the graph. |
| Constructor injection | **Supported** | Single-constructor and `@Autowired` constructor parameter resolution to matching bean types. |
| `@Service` / `@Repository` / `@RestController` | **Heuristic** | Recognized via static annotation presence; associated as candidate Spring beans without running application context. |
| `@Qualifier` | **Supported** | Disambiguates candidate implementations matching the qualifier name or string value. |
| `@Bean` | **Supported** | Method-level factory bean definitions extracted from `@Configuration` classes. |
| `@Profile` | **Detected (Uncertain)** | Profile annotations are detected on components, but active profiles are not resolved at static analysis time. Matching candidates remain marked as uncertain. |
| `@Conditional` | **Unsupported** | Runtime condition evaluation (`@ConditionalOnProperty`, `@ConditionalOnClass`, etc.) is not evaluated statically. |
| Lombok | **Unsupported** | Generated methods (`@Data`, `@Getter`, `@RequiredArgsConstructor`, etc.) are not expanded because source-only parsing does not run annotation processors. |
| Kotlin | **Unsupported** | Kotlin `.kt` files are excluded; analyzer operates exclusively on `.java` source files. |
| Groovy | **Unsupported** | Groovy `.groovy` files are excluded. |
| Annotation processors | **Unsupported** | Source-only parsing never executes `javac` annotation processors or external code generators during import. |
