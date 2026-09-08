package com.example.largeproject.pkg6;

import com.example.largeproject.pkg7.Class71;

public class Class62 {
    public void doSomething() {
        new Class71().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
