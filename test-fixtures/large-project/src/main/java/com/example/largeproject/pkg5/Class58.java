package com.example.largeproject.pkg5;

import com.example.largeproject.pkg7.Class77;

public class Class58 {
    public void doSomething() {
        new Class77().process();
        new Class51().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
