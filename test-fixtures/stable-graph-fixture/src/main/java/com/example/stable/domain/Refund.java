package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Refund {
    private Payment payment;
    private Money amount;

    public Payment getPayment() {
        return payment;
    }

    public Money getAmount() {
        return amount;
    }
}
