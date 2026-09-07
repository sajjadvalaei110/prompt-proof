package com.example.largeproject.pkg6;

import com.example.largeproject.pkg4.Class44;

public class Class64 {
    public void doSomething() {
        new Class44().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
