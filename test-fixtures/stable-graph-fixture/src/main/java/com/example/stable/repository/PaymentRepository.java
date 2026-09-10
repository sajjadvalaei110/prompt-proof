package com.example.stable.repository;

import com.example.stable.domain.Payment;
import org.springframework.stereotype.Repository;

@Repository
public class PaymentRepository {
    public Payment findById(Long id) {
        return null;
    }

    public Payment save(Payment entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
