package com.example.stable.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Ambiguous injection: EmailChannel and SmsChannel both qualify. */
@Service
public class NotificationService {
    @Autowired
    private NotificationChannel channel;

    public void notifyCustomer(String message) {
        channel.deliver(message);
    }
}
