package com.example.orders.model;

public class Payment {
    private double amount;
    private String method;

    public Payment(double amount, String method) {
        this.amount = amount;
        this.method = method;
    }
}
