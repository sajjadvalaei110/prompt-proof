package com.example.core;

public abstract class BaseGreeter implements Greeter {
    protected final String prefix;

    protected BaseGreeter(String prefix) {
        this.prefix = prefix;
    }

    protected String decorate(String text) {
        return prefix + text;
    }

    protected String decorate(String text, int times) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < times; i++) {
            out.append(decorate(text));
        }
        return out.toString();
    }
}
