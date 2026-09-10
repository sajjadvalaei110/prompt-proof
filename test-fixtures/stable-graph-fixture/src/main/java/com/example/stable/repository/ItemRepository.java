package com.example.stable.repository;

import com.example.stable.domain.Item;
import org.springframework.stereotype.Repository;

@Repository
public class ItemRepository {
    public Item findById(Long id) {
        return null;
    }

    public Item save(Item entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
