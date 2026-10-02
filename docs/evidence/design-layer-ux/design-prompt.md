# Changes to make

Please make these changes to this Java codebase. Each item says what to add or change and why; the purpose or reason is a requirement. Read the existing code for everything else.

## Add

1. Add a package `com.example.audit`. Purpose: Audit trail for order changes.
   Every state change of an order is recorded once, append-only.
2. Add a package `com.example.notes`.
3. Add a package `com.example.racecheck`. Purpose: Lands while a create is still in flight.
4. Add an interface `AuditLog` in package `com.example.audit`. Purpose: Append-only store of audit entries.
5. Add a class `AuditQuery` in package `com.example.audit`.
6. Add a class `NoteDraft` in package `com.example.notes`.
7. Add a class `NoteIndex` in package `com.example.notes`.
8. Add a class `NoteStore` in package `com.example.notes`.
9. Add a class `OrderArchive` in package `com.example.spring.service`.
10. Add a class `OrderAudit` in package `com.example.spring.service`.
11. Add a method `search(String)` to class `AuditQuery` (package `com.example.audit`).
12. Add a method `void complete(Long orderId)` to class `OrderService` (package `com.example.spring.service`). Purpose: Marks an order completed and records it in the audit trail.
13. Add a method `findByCustomer(Long)` to class `OrderService` (package `com.example.spring.service`). Purpose: Lists the orders of one customer.

## Change

14. Change class `OrderService`, in package `com.example.spring.service`. What should change: Owns the order lifecycle from creation to completion.
   Planned change: publish an OrderCompleted event instead of calling billing directly.

## Connect

15. Class `AuditQuery` (new) should call interface `AuditLog` (new). Reason: Queries read the audit log.
16. Class `OrderService` should call interface `AuditLog` (new). Reason: Each completed order is appended to the audit trail.
