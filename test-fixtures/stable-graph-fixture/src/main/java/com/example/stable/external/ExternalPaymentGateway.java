package com.example.stable.external;

import com.example.stable.service.PaymentService;
import com.acme.gateway.GatewayBase;
import com.acme.gateway.GatewayCredentials;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * GatewayBase and GatewayCredentials are outside the indexed source, so those
 * relationships stay unresolved while the in-source collaborator resolves.
 */
@Component
public class ExternalPaymentGateway extends GatewayBase {
    @Autowired
    private GatewayCredentials credentials;

    @Autowired
    private PaymentService paymentService;

    public String describe() {
        return "ExternalPaymentGateway";
    }
}
