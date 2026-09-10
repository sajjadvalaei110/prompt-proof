package com.example.stable.service;

import com.example.stable.domain.Order;
import org.springframework.stereotype.Service;

/** Chain end. */
@Service
public class TaxService {
    public int rateFor(Order order) {
        return 21;
    }
}
