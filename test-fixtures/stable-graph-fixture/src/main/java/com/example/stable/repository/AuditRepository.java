package com.example.stable.repository;

import com.example.stable.domain.AuditEntry;
import org.springframework.stereotype.Repository;

@Repository
public class AuditRepository {
    public AuditEntry findById(Long id) {
        return null;
    }

    public AuditEntry save(AuditEntry entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
