package com.example.stable.external;

import com.example.stable.service.NotificationService;
import com.acme.mail.MailBase;
import com.acme.mail.MailCredentials;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * MailBase and MailCredentials are outside the indexed source, so those
 * relationships stay unresolved while the in-source collaborator resolves.
 */
@Component
public class ExternalMailClient extends MailBase {
    @Autowired
    private MailCredentials credentials;

    @Autowired
    private NotificationService notificationService;

    public String describe() {
        return "ExternalMailClient";
    }
}
