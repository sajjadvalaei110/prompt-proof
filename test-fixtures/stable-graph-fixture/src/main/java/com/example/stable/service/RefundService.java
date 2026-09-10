package com.example.stable.service;

import com.example.stable.domain.Refund;
import com.example.stable.repository.RefundRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class RefundService {
    @Autowired
    private RefundRepository repository;

    @Autowired
    private OrderService orderService;

    public Refund load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
