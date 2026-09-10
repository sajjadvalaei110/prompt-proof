package com.example.stable.external;

import com.example.stable.service.ReportService;
import com.acme.analytics.AnalyticsBase;
import com.acme.analytics.AnalyticsCredentials;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * AnalyticsBase and AnalyticsCredentials are outside the indexed source, so those
 * relationships stay unresolved while the in-source collaborator resolves.
 */
@Component
public class ExternalAnalyticsClient extends AnalyticsBase {
    @Autowired
    private AnalyticsCredentials credentials;

    @Autowired
    private ReportService reportService;

    public String describe() {
        return "ExternalAnalyticsClient";
    }
}
