package com.example.core;

public record Greeting(String text) implements Greeter {
    @Override
    public String greet(String name) {
        return text + name;
    }

    public static class Builder {
        public Greeting build() {
            return new Greeting("Hi, ");
        }
    }
}
