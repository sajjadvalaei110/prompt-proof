package com.example.spring.repository;

import com.example.spring.model.Order;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcOrderRepository implements OrderRepository {
    @Override
    public Order findById(Long id) { return new Order(); }
    @Override
    public Order save(Order order) { return order; }
}
