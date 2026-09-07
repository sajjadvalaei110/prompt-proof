package com.example.orders.service;

import com.example.orders.model.Payment;

public interface PaymentProcessor {
    void process(Payment payment);
}
