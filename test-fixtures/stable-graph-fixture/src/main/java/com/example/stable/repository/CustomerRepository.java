package com.example.stable.repository;

import com.example.stable.domain.Customer;
import org.springframework.stereotype.Repository;

@Repository
public class CustomerRepository {
    public Customer findById(Long id) {
        return null;
    }

    public Customer save(Customer entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
