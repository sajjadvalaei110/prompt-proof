package com.example.core;

public class FriendlyGreeter extends BaseGreeter {
    public FriendlyGreeter() {
        super("Hello, ");
    }

    @Override
    public String greet(String name) {
        String decorated = decorate(name);
        return decorated + "!";
    }
}
