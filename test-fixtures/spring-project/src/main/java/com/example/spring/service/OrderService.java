package com.example.spring.service;

import com.example.spring.model.Order;
import com.example.spring.repository.OrderRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository orderRepository;

    @Autowired
    @Qualifier("primaryPayment")
    private PaymentService paymentService;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public Order create(Order order) {
        paymentService.process();
        return orderRepository.save(order);
    }

    public Order findById(Long id) {
        return orderRepository.findById(id);
    }
}
