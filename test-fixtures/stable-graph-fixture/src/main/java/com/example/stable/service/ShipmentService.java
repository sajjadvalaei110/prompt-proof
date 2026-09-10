package com.example.stable.service;

import com.example.stable.domain.Shipment;
import com.example.stable.repository.ShipmentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ShipmentService {
    @Autowired
    private ShipmentRepository repository;

    @Autowired
    private OrderService orderService;

    public Shipment load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
