package com.example.stable.service;

import com.example.stable.domain.Customer;
import com.example.stable.repository.CustomerRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    @Autowired
    private CustomerRepository repository;

    @Autowired
    private OrderService orderService;

    public Customer load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
