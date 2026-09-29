# ADR 0010: Candidate calls and OVERRIDES facts

- Status: Accepted (user decisions D1–D5, 2026-09-25); D1 withdrawn by the 2026-09-25 amendment "candidate calls reverted"
- Date: 2026-09-25
- Scope: analyzer (`JavaParserAdapter`), relationship kinds, the outgoing relation stack
  (`docs/OUTGOING_STACK.md`)

## Context

The outgoing relation stack walks parser facts at the root's granularity (user decision
2026-09-25). Measured on real analyzer output, a method root's journey was mostly incomplete. The
headline case: `EventController.registerParticipant(..)` in `test-fixtures/microservice-java` had
an **empty** stack, even though it calls `EventService.registerParticipant(..)`, which reaches the
repositories, exceptions, domain and dtos. There were three analyzer-side causes:

1. **In-source calls that fail symbol resolution never became edges.** The policy was "method
   targets are never guessed": an unresolvable call was stored as `CALLS` / `UNRESOLVED` with no
   target, so it appeared only in `metadata.unresolvedRelationships`. The receiver's type was
   known, but it only fed the class-level `DEPENDS_ON`. There are four in-source shapes:
   - (a) a unique target whose argument typing failed (for example, a record-accessor argument);
   - (b) implicit record accessors;
   - (c) Lombok-generated members;
   - (d) library methods inherited by an in-source type (`eventRepository.findAll()`).
2. **No dispatch fact.** A call to an interface or abstract method stopped the chain: there was no
   method-level link to its in-source implementations (for example
   `ShoppingCartService.addItem` → `ShoppingCartServiceImpl.addItem` in online-book-store).
3. The frontend side (type-targeted facts, layer numbering, walking past undrawn entities) is
   recorded in `docs/OUTGOING_STACK.md`.

AGENTS.md: parser facts own graph structure, and every relationship has evidence and an explicit
resolution status. A frontend-only inference from `unresolvedRelationships` text was rejected: it
would put structure outside the parser, and the metadata has no receiver type.

## Decision

**D1: candidate calls.** Keep "never guess silently", but emit explicit, labeled CANDIDATE facts.
A post-pass, `linkDispatchAndCandidateCalls`, runs once after every file's relationship pass, when
the whole in-source type hierarchy is known. It runs in one transaction; if it fails, a diagnostic
is recorded and the facts stay as they were. For a `CALLS` occurrence whose resolution **threw**:

- (i) The receiver type (for a call without a receiver, the calling type) or one of its in-source
  supertypes may have exactly one method signature with the called name and argument count. The
  nearest declaration of a signature wins, and varargs take `n-1` or more arguments. A private
  method counts only for a call on its own type (it is invisible to subtypes and other types). Then the
  occurrence becomes `CALLS` / `CANDIDATE` to that method, reason "Unique in-source name/arity
  match; argument types unresolved".
- (ii) Otherwise, if the receiver type is in source and is not the calling type, the occurrence
  becomes `CALLS` / `CANDIDATE` to the **receiver type**. The reason is "Member not declared in
  source …" when no in-source method matches, or "Several in-source methods match name/arity …"
  for ambiguous overloads.
- (iii) Otherwise it stays `UNRESOLVED`. This also covers a call the symbol solver **did** resolve
  to a JDK method (`exception.getMessage()`): its target is known to be external.

The occurrence keeps its id and call-site evidence; only its target, resolution and reason change.
A method reference (`foo::bar`) that cannot be resolved is unchanged.

**D3: OVERRIDES.** A new relationship kind. The post-pass emits `OVERRIDES` / `RESOLVED` from each
in-source method to every in-source supertype method (direct or inherited, through the
`EXTENDS`/`IMPLEMENTS` chain) that it overrides or implements. The test: the same name and the same
erased simple parameter types (`List<String>` is `List`), with neither method static nor private.
The evidence is the overriding method's name. The reason is "Same name and parameter types as the
in-source supertype method; calls to it may dispatch here at runtime".

No migration: `relationship_occurrences.kind` is unconstrained TEXT. The enum
(`RelationshipKind.java`) and the frontend union (`types/index.ts`) gain `OVERRIDES`. The edge
label is "overrides". Routes whose resolution is not RESOLVED already draw dashed (ADR 0008).

The frontend decisions (D2 type-targeted facts; D3 dispatch as a reversed, +1 step and no reverse
`IMPLEMENTS` for class roots; D4 card-hop layers; D5 the beyond-the-map count) are recorded in
`docs/OUTGOING_STACK.md`.

## Consequences

- Graph edges grow and unresolved metadata shrinks. microservice-java goes from 36 to 22
  unresolved, with 14 CANDIDATE calls. online-book-store goes from 247 to 221 unresolved, with 26
  CANDIDATE calls and 29 OVERRIDES facts. No existing backend test pinned these counts.
- A method-granularity walk now reaches classes, packages and implementations it missed (the
  before/after table is in PROJECT_STATUS.md, step 12 phase C).
- Explanation context builders already rank CANDIDATE between RESOLVED and UNRESOLVED; OVERRIDES is
  an ordinary relationship for them.
- Limits:
  - Erasure by simple name cannot match a generic supertype parameter (`save(T)`) with a concrete
    override (`save(Book)`), so no OVERRIDES fact is emitted there.
  - Two different types with the same simple name in parameter position could, in theory,
    produce a false OVERRIDES. (Found real by the phase C review, C2; fixed by the amendment below.)
  - Field initializers and initializer blocks remain owned by the type (a method root never sees
    them).
  - Unresolved method references are not upgraded.

## Amendment (2026-09-25): visibility, parameter identity and lexical receivers

The phase C review (`/home/sajjad/prompts/step12/phase-c-review-report.md`, findings C1–C4) showed
that four rules above emitted facts Java does not allow. User decisions F1–F3 were taken before the
fix. None of this reopens D1–D5.

- **C1, package-private.** A package-private method is not inherited outside its package (JLS
  §8.4.8.1). OVERRIDES to a package-private supertype method is emitted only when both types are in
  the same package. Interface members count as public.
- **C2, parameter identity.** The erased simple name let `same(y.Value)` "override"
  `same(x.Value)`. A parameter is now identified by the in-source type it resolves to (through the
  same resolution as type references), else by its erased name as written. Two parameters match
  when both resolve to the same in-source type, or neither resolves and the names are equal.
  - **F1:** when one side resolves and the other does not (`at(b.Date)` against
    `at(java.util.Date)`), no OVERRIDES is emitted. A missing dispatch step is honest; a false
    RESOLVED fact is not.
- **C3, anonymous and local classes.** A call without a receiver inside an anonymous class body or
  a local class was queued on the outer named type, producing a false CANDIDATE.
  - **F2:** such a call is never queued and stays UNRESOLVED. Its target may be the class's own
    method or one inherited from its supertype, neither of which the post-pass can see. A call in
    an anonymous class's constructor arguments is outside its body and is unaffected.
- **C4, nests.** A private method is a member of its declaring type only, and is accessible
  anywhere in the same nest (JLS §6.6.1). It now counts for a call whose receiver type is its
  declaring type and whose caller shares that type's nest host, so `Outer.this.work(..)` from a
  member class finds `Outer.work`. A subtype still never matches its supertype's private method.
  - **F3:** a call without a receiver takes as its receiver the innermost lexically enclosing named
    type that has a method of that name (declared, or inherited from an in-source supertype),
    following JLS §15.12.1. The walk stops at a type whose members the source may not fully show:
    a type with a supertype outside the source, a record or an enum, or a name every type inherits
    from `Object`. If no enclosing type has the name, the receiver is the calling type, as before.
    An implicit call without a unique match stays UNRESOLVED, as before.

Consequences:
- Measured on the same fixture copies as phase C, the facts are **identical**: microservice-java
  still has 22 unresolved and 14 CALLS CANDIDATE; online-book-store still has 221 unresolved, 26
  CALLS CANDIDATE and 29 OVERRIDES. Every edge and unresolved entry matches by
  (source, target, kind, resolution). Neither project has a cross-package package-private
  override, a same-named parameter type pair, a pending implicit call in an anonymous or local
  class, or a pending call to a private outer member.
- Limits: an implicit call inside a member class whose own members are generated (Lombok) and
  whose supertypes are all in source can still be matched against an outer method with that name.
  A package-private method overridden through an intermediate same-package override gets the two
  one-step facts (C→B, B→A), not a direct C→A fact. The reversed walk still reaches C.

## Amendment (2026-09-25): candidate calls reverted

User decision, the same day: **D1 is withdrawn; D3 (OVERRIDES) is kept.** An aggregated route takes
the least-certain resolution of its occurrences, so one CANDIDATE call among many resolved facts
turned the whole route amber and dashed, and the map read as mostly yellow. The user judged that
noise worse than the missing method-level steps.

- The analyzer no longer collects pending calls and the post-pass no longer upgrades anything. A
  call the symbol solver cannot resolve is stored as before phase C: `CALLS` / `UNRESOLVED`, no
  target, reason "Static target unavailable in indexed source", listed in
  `metadata.unresolvedRelationships`. Its receiver's declared type still yields the class-level
  `DEPENDS_ON`.
- The post-pass is renamed `linkOverrides` (in `JavaParserAdapter` and `AnalysisService`) and only
  emits OVERRIDES, unchanged: parameter identity by `parameterKey` (F1), the package-private rule
  (C1). The candidate-only helpers (pending calls, lexical receivers, nest hosts, opaque types,
  `Object` method names, the anonymous/local-class check) are removed. F2 and F3 and the C3/C4
  candidate rules of the amendment above no longer apply.
- `CANDIDATE` stays a valid resolution (Spring injection still uses it), and the frontend helper
  still treats a CALLS fact to a type as terminal (D2); the analyzer just no longer emits one.
- Measured on the same fixture copies with the packaged jar: microservice-java 36 unresolved,
  0 CALLS CANDIDATE, 0 OVERRIDES; online-book-store 247 unresolved, 0 CALLS CANDIDATE,
  29 OVERRIDES. The unresolved counts are back to the pre-phase-C values.
- Consequence for the stack: a method root whose calls are unresolvable reaches only what its
  resolved facts reach (the journey fixture's `SignupController.register` reaches only its
  parameter type again). Dispatch through OVERRIDES still works from a resolved call to an
  interface or abstract method.
- Tests: `CandidateCallsAndOverridesTest` became `UnresolvedCallsAndOverridesTest` and
  `CandidateAndOverrideEdgeCasesTest` became `OverridesAndUnresolvedCallEdgeCasesTest`; their
  former candidate cases now assert the calls stay UNRESOLVED with no target and that no
  CALLS/CANDIDATE exists.
