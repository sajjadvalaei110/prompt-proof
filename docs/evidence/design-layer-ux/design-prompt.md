# Changes to make

Please make these changes to this Java codebase. Each item says what to add or change and why; the purpose or reason is a requirement. Read the existing code for everything else.

## Add

1. Add a package `com.example.audit`. Purpose: Audit trail for order changes.
   Every state change of an order is recorded once, append-only.
2. Add an interface `AuditLog` in package `com.example.audit`. Purpose: Append-only store of audit entries.
3. Add a class `AuditQuery` in package `com.example.audit`.
4. Add a class `OrderAudit` in package `com.example.spring.service`.
5. Add a method `search(String)` to class `AuditQuery` (package `com.example.audit`).
6. Add a method `void complete(Long orderId)` to class `OrderService` (package `com.example.spring.service`). Purpose: Marks an order completed and records it in the audit trail.
7. Add a method `findByCustomer(Long)` to class `OrderService` (package `com.example.spring.service`). Purpose: Lists the orders of one customer.

## Change

8. Change class `OrderService`, in package `com.example.spring.service`. What should change: Owns the order lifecycle from creation to completion.
   Planned change: publish an OrderCompleted event instead of calling billing directly.

## Connect

9. Class `AuditQuery` (new) should call interface `AuditLog` (new). Reason: Queries read the audit log.
10. Class `OrderService` should call interface `AuditLog` (new). Reason: Each completed order is appended to the audit trail.
