package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Payment {
    private Invoice invoice;
    private Money amount;

    public Invoice getInvoice() {
        return invoice;
    }

    public Money getAmount() {
        return amount;
    }
}
