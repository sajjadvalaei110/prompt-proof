package com.example.orders.repository;

import com.example.orders.model.Order;

public interface OrderRepository {
    Order save(Order order);
    Order findById(Long id);
    Order findByReference(String reference);
}
