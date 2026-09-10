package com.example.stable.service;

import com.example.stable.domain.Order;
import com.example.stable.repository.OrderRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Shares the OrderRepository sink to produce visible fan-in. */
@Service
public class ArchiveService {
    @Autowired
    private OrderRepository orderRepository;

    public Order latest(Long id) {
        return orderRepository.findById(id);
    }
}
