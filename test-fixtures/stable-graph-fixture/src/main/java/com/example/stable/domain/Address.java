package com.example.stable.domain;

/** Domain entity used to give the class map realistic fan-in. */
public class Address {
    private String street;
    private String city;

    public String getStreet() {
        return street;
    }

    public String getCity() {
        return city;
    }
}
