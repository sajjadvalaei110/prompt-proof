package com.example.stable.repository;

import com.example.stable.domain.Shipment;
import org.springframework.stereotype.Repository;

@Repository
public class ShipmentRepository {
    public Shipment findById(Long id) {
        return null;
    }

    public Shipment save(Shipment entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
