package com.example.stable.service;

import org.springframework.stereotype.Component;

@Component
public class EmailChannel implements NotificationChannel {
    @Override
    public void deliver(String message) {
    }
}
