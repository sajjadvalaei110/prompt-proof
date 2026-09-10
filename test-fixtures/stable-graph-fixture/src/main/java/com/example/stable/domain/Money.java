package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Money {
    private long amountMinor;
    private String currency;

    public long getAmountMinor() {
        return amountMinor;
    }

    public String getCurrency() {
        return currency;
    }
}
