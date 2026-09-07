package com.example.orders.service;

import com.example.orders.model.Payment;
import org.springframework.stereotype.Component;

@Component("creditCard")
public class CreditCardProcessor implements PaymentProcessor {
    @Override
    public void process(Payment payment) {
        // process credit card
    }
}
