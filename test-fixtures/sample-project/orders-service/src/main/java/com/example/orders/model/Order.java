package com.example.orders.model;

import java.util.List;
import java.util.Date;

public class Order {
    private Long id;
    private String reference;
    private List<String> items;
    private double total;
    private String status;
    private Date createdAt;
    
    // getters and setters omitted for brevity
    public void setItems(List<String> items) { this.items = items; }
    public void setStatus(String status) { this.status = status; }
}
