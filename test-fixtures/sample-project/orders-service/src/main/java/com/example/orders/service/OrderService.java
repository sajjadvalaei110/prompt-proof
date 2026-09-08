package com.example.orders.service;

import com.example.orders.model.Order;
import com.example.orders.model.CreateOrderRequest;
import com.example.orders.model.Payment;
import com.example.orders.repository.OrderRepository;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Qualifier;

@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentProcessor paymentProcessor;

    public OrderService(OrderRepository orderRepository, @Qualifier("creditCard") PaymentProcessor paymentProcessor) {
        this.orderRepository = orderRepository;
        this.paymentProcessor = paymentProcessor;
    }

    public Order createOrder(CreateOrderRequest request) {
        validateOrder(request);
        
        Payment payment = new Payment(request.getTotalAmount(), request.getPaymentMethod());
        paymentProcessor.process(payment);
        
        Order order = new Order();
        order.setItems(request.getItems());
        order.setStatus("CREATED");
        
        return orderRepository.save(order);
    }

    public Order getOrderById(Long id) {
        return orderRepository.findById(id);
    }

    public void cancelOrder(Long id) {
        Order order = orderRepository.findById(id);
        if (order != null) {
            order.setStatus("CANCELLED");
            orderRepository.save(order);
        }
    }

    private void validateOrder(CreateOrderRequest request) {
        if (request.getItems() == null || request.getItems().isEmpty()) {
            throw new IllegalArgumentException("Items cannot be empty");
        }
    }

    public Order findOrder(Long id) {
        return orderRepository.findById(id);
    }

    public Order findOrder(String reference) {
        return orderRepository.findByReference(reference);
    }
}
