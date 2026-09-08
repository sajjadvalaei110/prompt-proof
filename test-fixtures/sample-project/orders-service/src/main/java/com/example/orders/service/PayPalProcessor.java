package com.example.orders.service;

import com.example.orders.model.Payment;
import org.springframework.stereotype.Component;

@Component("paypal")
public class PayPalProcessor implements PaymentProcessor {
    @Override
    public void process(Payment payment) {
        // process paypal
    }
}
