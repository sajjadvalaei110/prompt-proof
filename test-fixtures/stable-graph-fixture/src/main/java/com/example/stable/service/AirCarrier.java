package com.example.stable.service;

import org.springframework.stereotype.Component;

@Component
public class AirCarrier implements ShipmentCarrier {
    @Override
    public String dispatch(String reference) {
        return reference;
    }
}
