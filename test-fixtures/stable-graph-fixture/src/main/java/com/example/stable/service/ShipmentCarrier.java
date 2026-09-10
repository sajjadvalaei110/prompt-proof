package com.example.stable.service;

/** Two unqualified implementations exist, so injection stays ambiguous. */
public interface ShipmentCarrier {
    String dispatch(String reference);
}
