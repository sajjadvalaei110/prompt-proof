package com.example.stable.service;

import com.example.stable.domain.Payment;
import com.example.stable.repository.PaymentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Reciprocal partner of FraudService. */
@Service
public class PaymentService {
    @Autowired
    private FraudService fraudService;

    @Autowired
    private PaymentRepository paymentRepository;

    public Payment capture(Payment payment) {
        fraudService.check(payment);
        return paymentRepository.save(payment);
    }

    public String status(Payment payment) {
        return "CAPTURED";
    }
}
