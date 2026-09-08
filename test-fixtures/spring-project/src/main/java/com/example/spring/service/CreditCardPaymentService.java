package com.example.spring.service;

import org.springframework.stereotype.Component;

@Component("primaryPayment")
public class CreditCardPaymentService implements PaymentService {
    @Override
    public void process() {
        System.out.println("Processing credit card payment");
    }
}
