package com.example.largeproject.pkg1;

import com.example.largeproject.pkg4.Class44;

public class Class11 {
    public void doSomething() {
        new Class10().process();
        new Class44().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
