package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Discount {
    private String code;
    private Money amount;

    public String getCode() {
        return code;
    }

    public Money getAmount() {
        return amount;
    }
}
