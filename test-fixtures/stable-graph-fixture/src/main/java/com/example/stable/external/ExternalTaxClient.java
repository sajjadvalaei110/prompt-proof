package com.example.stable.external;

import com.example.stable.service.TaxService;
import com.acme.tax.TaxBase;
import com.acme.tax.TaxCredentials;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * TaxBase and TaxCredentials are outside the indexed source, so those
 * relationships stay unresolved while the in-source collaborator resolves.
 */
@Component
public class ExternalTaxClient extends TaxBase {
    @Autowired
    private TaxCredentials credentials;

    @Autowired
    private TaxService taxService;

    public String describe() {
        return "ExternalTaxClient";
    }
}
