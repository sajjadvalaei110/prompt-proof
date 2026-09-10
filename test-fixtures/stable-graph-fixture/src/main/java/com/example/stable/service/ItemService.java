package com.example.stable.service;

import com.example.stable.domain.Item;
import com.example.stable.repository.ItemRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ItemService {
    @Autowired
    private ItemRepository repository;

    @Autowired
    private OrderService orderService;

    public Item load(Long id) {
        orderService.findById(id);
        return repository.findById(id);
    }
}
