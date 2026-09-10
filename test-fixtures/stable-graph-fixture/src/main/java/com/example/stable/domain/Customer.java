package com.example.stable.domain;

/** Cycle member: Customer -> Order closes the three-node cycle. */
public class Customer {
    private Order lastOrder;
    private Address address;

    public String displayName() {
        return lastOrder.reference();
    }

    public Address getAddress() {
        return address;
    }
}
