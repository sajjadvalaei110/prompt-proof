package com.example.stable.external;

import com.example.stable.service.ShipmentService;
import com.acme.shipping.ShippingBase;
import com.acme.shipping.ShippingCredentials;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * ShippingBase and ShippingCredentials are outside the indexed source, so those
 * relationships stay unresolved while the in-source collaborator resolves.
 */
@Component
public class ExternalShippingClient extends ShippingBase {
    @Autowired
    private ShippingCredentials credentials;

    @Autowired
    private ShipmentService shipmentService;

    public String describe() {
        return "ExternalShippingClient";
    }
}
