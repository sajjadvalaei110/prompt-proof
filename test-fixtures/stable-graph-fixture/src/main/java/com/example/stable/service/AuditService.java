package com.example.stable.service;

import com.example.stable.domain.AuditEntry;
import com.example.stable.repository.AuditRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    @Autowired
    private AuditRepository repository;

    @Autowired
    private OrderService orderService;

    public AuditEntry load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
