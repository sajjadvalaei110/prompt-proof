package com.example.largeproject.pkg2;


public class Class28 {
    public void doSomething() {
        new Class24().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
