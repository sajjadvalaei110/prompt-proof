package com.example.largeproject.pkg3;

import com.example.largeproject.pkg0.Class5;

public class Class30 {
    public void doSomething() {
        new Class5().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
