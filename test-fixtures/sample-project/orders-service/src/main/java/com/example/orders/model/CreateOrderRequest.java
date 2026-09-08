package com.example.orders.model;

import java.util.List;

public class CreateOrderRequest {
    private List<String> items;
    private String paymentMethod;
    private double totalAmount;

    public List<String> getItems() { return items; }
    public String getPaymentMethod() { return paymentMethod; }
    public double getTotalAmount() { return totalAmount; }
}
