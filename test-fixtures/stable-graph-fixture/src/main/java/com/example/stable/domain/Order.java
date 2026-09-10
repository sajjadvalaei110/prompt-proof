package com.example.stable.domain;

/** Cycle member: Order -> Item -> Customer -> Order (method calls, not just fields). */
public class Order {
    private Long id;
    private Item item;
    private Money total;
    private Discount discount;

    public String summary() {
        return item.label();
    }

    public String reference() {
        return "ORD-" + id;
    }

    public Money getTotal() {
        return total;
    }

    public Discount getDiscount() {
        return discount;
    }
}
