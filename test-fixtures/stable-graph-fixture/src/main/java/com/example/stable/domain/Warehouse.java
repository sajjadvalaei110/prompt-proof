package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Warehouse {
    private String code;
    private Address address;

    public String getCode() {
        return code;
    }

    public Address getAddress() {
        return address;
    }
}
