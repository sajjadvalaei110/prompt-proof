package com.example.stable.domain;

/** Cycle member: Item -> Customer. */
public class Item {
    private Customer customer;
    private Product product;
    private Money price;

    public String label() {
        return customer.displayName();
    }

    public Product getProduct() {
        return product;
    }

    public Money getPrice() {
        return price;
    }
}
