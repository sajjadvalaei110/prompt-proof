package com.example.spring.config;

public class EmailSender {
    public void send(String to, String message) {
        System.out.println("Sending email to " + to + ": " + message);
    }
}
