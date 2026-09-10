package com.example.stable.service;

/** Two unqualified implementations exist, so injection stays ambiguous. */
public interface NotificationChannel {
    void deliver(String message);
}
