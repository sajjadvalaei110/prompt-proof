package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Invoice {
    private Order order;
    private Money total;

    public Order getOrder() {
        return order;
    }

    public Money getTotal() {
        return total;
    }
}
