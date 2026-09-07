package com.example.orders.api;

import com.example.orders.model.Order;
import com.example.orders.model.CreateOrderRequest;
import com.example.orders.service.OrderService;
import org.springframework.web.bind.annotation.*;
import java.util.Optional;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public Order createOrder(@RequestBody CreateOrderRequest request) {
        return orderService.createOrder(request);
    }

    @GetMapping("/{id}")
    public Optional<Order> getOrder(@PathVariable Long id) {
        return Optional.ofNullable(orderService.getOrderById(id));
    }
}
