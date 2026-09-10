package com.example.stable.service;

import com.example.stable.domain.Payment;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Reciprocal partner of PaymentService. */
@Service
public class FraudService {
    @Autowired
    private PaymentService paymentService;

    public boolean check(Payment payment) {
        return paymentService.status(payment).isEmpty();
    }
}
