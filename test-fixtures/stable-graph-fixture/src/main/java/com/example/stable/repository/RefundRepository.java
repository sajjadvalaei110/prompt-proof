package com.example.stable.repository;

import com.example.stable.domain.Refund;
import org.springframework.stereotype.Repository;

@Repository
public class RefundRepository {
    public Refund findById(Long id) {
        return null;
    }

    public Refund save(Refund entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
