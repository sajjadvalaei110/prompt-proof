# Code Atlas — Construct Support Matrix

This document defines the static analysis support status for Java language constructs, Spring framework annotations, and ecosystem tooling in Code Atlas.

## Support Status Categories

The Git review feature compares retained source snapshots; its capture limits,
unsupported symlinks/submodules and raw-byte diff behavior are described in
[Review local changes](GIT_REVIEW.md). Non-Java file changes remain in the file
inventory. They do not become graph nodes. Parse failures and unresolved
relationships remain explicit comparison diagnostics.

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
| Inheritance | **Supported** | `extends` and `implements` hierarchies (classes, interfaces, records, enums) fully extracted and navigable in the graph. |
| Constructors and object creation | **Supported** | Explicit constructors and record compact constructors are indexed as `CONSTRUCTOR` symbols with their own source range, keyed `Type.Type(params)` (a compact constructor takes the record components as its parameters); only when the type also declares a method with that exact name and parameter list is the constructor keyed `Type.<init>(params)`. `new T(..)` produces `CONSTRUCTS` to the resolved declared constructor, or to the type when it declares none (implicit/Lombok constructors). The symbol solver cannot resolve record constructors, so `new R(..)` targets a record's declared canonical constructor only when no other constructor of that record takes the same number of arguments (and none is varargs); otherwise the record. `T::new` always targets the type: JavaParser cannot resolve constructor references. A type constructing itself from its own field initializer or initializer block adds no self edge. Constructor bodies, field initializers and initializer blocks are scanned like method bodies. Constructors are not part of Explain all (which covers `CLASS` and `METHOD` only). |
| Type usage | **Supported** | Field, parameter, return, local-variable, generic-argument, cast, `instanceof`, class-literal, `throws`/`catch`, annotation and static-member references to indexed types produce one `USES_TYPE` per (member, type) with every site as evidence. References to JDK/library types are not recorded. Type names resolve through the symbol solver, then Java name lookup (enclosing types, single-type and single-static imports, same package, a unique on-demand import). A name that is a variable in scope (parameter, catch parameter, earlier local or pattern variable, declared field) is not treated as a type; fields inherited from a supertype are not visible to that check. Local classes are not indexed: their code belongs to the enclosing member. |
| Class dependency summary | **Supported** | One `DEPENDS_ON` per (type, other type) summarizes `extends`/`implements`, calls, constructions and type usage, so package connections appear even when a package is only reached through DTO construction or signatures. |
| Constructor injection | **Supported** | Single-constructor and `@Autowired` constructor parameter resolution to matching bean types. |
| `@Service` / `@Repository` / `@RestController` | **Heuristic** | Recognized via static annotation presence; associated as candidate Spring beans without running application context. |
| `@Qualifier` | **Supported** | Disambiguates candidate implementations matching the qualifier name or string value. |
| `@Bean` | **Supported** | Method-level factory bean definitions extracted from `@Configuration` classes. |
| `@Profile` | **Detected (Uncertain)** | Profile annotations are detected on components, but active profiles are not resolved at static analysis time. Matching candidates remain marked as uncertain. |
| `@Conditional` | **Unsupported** | Runtime condition evaluation (`@ConditionalOnProperty`, `@ConditionalOnClass`, etc.) is not evaluated statically. |
| Lombok | **Unsupported** | Generated methods (`@Data`, `@Getter`, `@RequiredArgsConstructor`, etc.) are not expanded because source-only parsing does not run annotation processors. A call to a generated getter stays an unresolved `CALLS` occurrence, but the receiver's declared type still yields the class-level `DEPENDS_ON`. |
| Kotlin | **Unsupported** | Kotlin `.kt` files are excluded; analyzer operates exclusively on `.java` source files. |
| Groovy | **Unsupported** | Groovy `.groovy` files are excluded. |
| Annotation processors | **Unsupported** | Source-only parsing never executes `javac` annotation processors or external code generators during import. |
