package com.example.spring.service;

import org.springframework.stereotype.Component;

@Component("alternativePayment")
public class PayPalPaymentService implements PaymentService {
    @Override
    public void process() {
        System.out.println("Processing PayPal payment");
    }
}
