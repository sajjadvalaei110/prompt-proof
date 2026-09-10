package com.example.stable.service;

import com.example.stable.domain.Invoice;
import com.example.stable.repository.InvoiceRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class InvoiceService {
    @Autowired
    private InvoiceRepository repository;

    @Autowired
    private OrderService orderService;

    public Invoice load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
