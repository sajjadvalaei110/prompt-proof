package com.example.orders.repository;

import com.example.orders.model.Order;
import org.springframework.stereotype.Repository;

@Repository
public class JpaOrderRepository implements OrderRepository {
    @Override
    public Order save(Order order) {
        return order;
    }

    @Override
    public Order findById(Long id) {
        return new Order();
    }

    @Override
    public Order findByReference(String reference) {
        return new Order();
    }
}
