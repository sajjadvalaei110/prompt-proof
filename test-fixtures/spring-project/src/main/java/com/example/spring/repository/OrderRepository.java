package com.example.spring.repository;

import com.example.spring.model.Order;

public interface OrderRepository {
    Order findById(Long id);
    Order save(Order order);
}
