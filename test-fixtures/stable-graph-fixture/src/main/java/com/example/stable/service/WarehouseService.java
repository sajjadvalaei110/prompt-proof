package com.example.stable.service;

import com.example.stable.domain.Warehouse;
import com.example.stable.repository.WarehouseRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class WarehouseService {
    @Autowired
    private WarehouseRepository repository;

    @Autowired
    private OrderService orderService;

    public Warehouse load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
