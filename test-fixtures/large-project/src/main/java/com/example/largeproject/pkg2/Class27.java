package com.example.largeproject.pkg2;

import com.example.largeproject.pkg8.Class82;

public class Class27 {
    public void doSomething() {
        new Class82().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
