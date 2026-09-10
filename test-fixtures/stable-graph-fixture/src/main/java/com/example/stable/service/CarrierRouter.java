package com.example.stable.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Ambiguous injection: AirCarrier and GroundCarrier both qualify. */
@Service
public class CarrierRouter {
    @Autowired
    private ShipmentCarrier carrier;

    public String route(String reference) {
        return carrier.dispatch(reference);
    }
}
