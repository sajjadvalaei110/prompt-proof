package com.example.stable.service;

import com.example.stable.domain.Money;
import com.example.stable.domain.Order;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Chain middle: PricingService -> TaxService. */
@Service
public class PricingService {
    @Autowired
    private TaxService taxService;

    public Money quote(Order order) {
        taxService.rateFor(order);
        return order.getTotal();
    }
}
