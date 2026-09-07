package com.example.largeproject.pkg8;

import com.example.largeproject.pkg9.Class98;

public class Class84 {
    public void doSomething() {
        new Class98().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
