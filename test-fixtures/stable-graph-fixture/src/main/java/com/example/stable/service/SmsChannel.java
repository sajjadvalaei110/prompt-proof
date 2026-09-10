package com.example.stable.service;

import org.springframework.stereotype.Component;

@Component
public class SmsChannel implements NotificationChannel {
    @Override
    public void deliver(String message) {
    }
}
