package com.example.stable.repository;

import com.example.stable.domain.Invoice;
import org.springframework.stereotype.Repository;

@Repository
public class InvoiceRepository {
    public Invoice findById(Long id) {
        return null;
    }

    public Invoice save(Invoice entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
