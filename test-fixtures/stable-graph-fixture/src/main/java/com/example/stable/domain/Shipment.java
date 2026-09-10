package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Shipment {
    private Order order;
    private Address destination;

    public Order getOrder() {
        return order;
    }

    public Address getDestination() {
        return destination;
    }
}
