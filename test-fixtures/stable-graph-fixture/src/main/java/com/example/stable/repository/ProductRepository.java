package com.example.stable.repository;

import com.example.stable.domain.Product;
import org.springframework.stereotype.Repository;

@Repository
public class ProductRepository {
    public Product findById(Long id) {
        return null;
    }

    public Product save(Product entity) {
        return entity;
    }

    public int count() {
        return 0;
    }
}
