package com.example.stable.service;

import com.example.stable.domain.Money;
import com.example.stable.domain.Order;
import com.example.stable.repository.OrderRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Chain start: OrderService -> PricingService -> TaxService. */
@Service
public class OrderService {
    private final OrderRepository orderRepository;

    @Autowired
    private PricingService pricingService;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public Order create(Order order) {
        Money quoted = pricingService.quote(order);
        return orderRepository.save(order);
    }

    public Order findById(Long id) {
        return orderRepository.findById(id);
    }
}
