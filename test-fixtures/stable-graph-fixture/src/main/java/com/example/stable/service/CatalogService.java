package com.example.stable.service;

import com.example.stable.domain.Product;
import com.example.stable.repository.ProductRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {
    @Autowired
    private ProductRepository repository;

    @Autowired
    private OrderService orderService;

    public Product load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
