package com.example.stable.repository;

import com.example.stable.domain.Order;
import org.springframework.stereotype.Repository;

@Repository
public class OrderRepository {
    public Order findById(Long id) {
        return null;
    }

    public Order save(Order entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
