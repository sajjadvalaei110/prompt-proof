package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Product {
    private String sku;
    private Category category;

    public String getSku() {
        return sku;
    }

    public Category getCategory() {
        return category;
    }
}
