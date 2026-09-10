package com.example.stable.repository;

import com.example.stable.domain.Warehouse;
import org.springframework.stereotype.Repository;

@Repository
public class WarehouseRepository {
    public Warehouse findById(Long id) {
        return null;
    }

    public Warehouse save(Warehouse entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
