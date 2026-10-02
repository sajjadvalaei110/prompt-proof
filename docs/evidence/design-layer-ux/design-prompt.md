# Implement the engineer's design: spring-project

You are working in a Java codebase. The software engineer designed changes on a map of it in Code Atlas.
This prompt lists **only what they designed**; read the source for everything else.

- **Keys** are the static analyzer's qualified names: package `com.acme.billing`, type
  `com.acme.billing.InvoiceService`, method `com.acme.billing.InvoiceService.issue(OrderId,boolean)`
  (parameter types as written in source).
- Each item's **intention** (the quoted text; its first paragraph is the intent) is a requirement to
  implement. An intention on code that already exists is a **requested behaviour change**.
- The source code is the authority on what exists. Intentions are the engineer's requirements, not facts
  about the code; where they conflict with the code, change the code, and say so when you report back.

## 1. Build: designed, not in the code yet

Create each of these with exactly this key, inside its parent.

- package `com.example.audit`
  > Audit trail for order changes.
  > 
  > Every state change of an order is recorded once, append-only.
- class `com.example.audit.AuditLog` in package `com.example.audit` (planned)
  (no intention written)
- class `com.example.audit.AuditQuery` in package `com.example.audit` (planned)
  (no intention written)
- method `com.example.spring.service.OrderService.complete(Long)` in package `com.example.spring.service` › class `com.example.spring.service.OrderService`
  Signature: `void complete(Long orderId)`
  > Marks an order completed and records it in the audit trail.
- method `com.example.spring.service.OrderService.findByCustomer(Long)` in package `com.example.spring.service` › class `com.example.spring.service.OrderService`
  (no intention written)

## 2. Change existing code

These already exist. Make their behaviour match the intention.

- class `com.example.spring.service.OrderService` in package `com.example.spring.service`
  > Owns the order lifecycle from creation to completion.
  > 
  > Planned change: publish an OrderCompleted event instead of calling billing directly.

## 3. Relations to implement

A designed relation `A -KIND-> B` means: the engineer wants A, or code inside A, to do KIND to B or to a resource inside B, for the reason given. Implement each relation in your change.

- `com.example.audit.AuditQuery` -CALLS-> `com.example.audit.AuditLog`
  The engineer wants the planned class `com.example.audit.AuditQuery` (or code inside it) to call the planned class `com.example.audit.AuditLog` or a resource inside it, because:
  > Queries read the audit log.
- `com.example.spring.service.OrderService` -CALLS-> `com.example.audit.AuditLog`
  The engineer wants the existing class `com.example.spring.service.OrderService` (or code inside it) to call the planned class `com.example.audit.AuditLog` or a resource inside it, because:
  > Each completed order is appended to the audit trail.

## Report back

When your change is done, record it in the design layer so the engineer sees it on the map. Code Atlas runs
locally at `http://127.0.0.1:8085` (loopback only); there is no approval step.

`POST http://127.0.0.1:8085/api/workspaces/2a461665-a811-4deb-b992-571190d5def8/design/changes` with `{"author": "<your agent name>", "operations": [...]}`.
The set is atomic (HTTP 400 names the failing operation); add `?dryRun=true` to validate without saving.

- `{"op": "putResource", "key": "<key>", "explanation": "..."}` sets the explanation of any resource, parsed or designed.
- `{"op": "putResource", "kind": "CLASS", "parentKey": "<package>", "name": "...", "explanation": "..."}` adds a resource
  you created that is not listed here (methods also take `parameterTypes` and `signature`).
- `{"op": "putRelation", "sourceKey": "...", "targetKey": "...", "kind": "CALLS", "explanation": "..."}` records a relation.
- `updateResource`, `deleteResource` and `deleteRelation` change or remove designed items.

You do not mark items done: once the code declares a planned key and the workspace is re-analyzed, it shows as
implemented. Where you deviated from an intention, say why in that item's explanation, keeping the intent
paragraph first. Full contract: `GET http://127.0.0.1:8085/api/agent-guide`.
