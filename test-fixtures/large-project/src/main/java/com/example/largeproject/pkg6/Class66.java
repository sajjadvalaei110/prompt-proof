package com.example.largeproject.pkg6;

import com.example.largeproject.pkg3.Class31;

public class Class66 {
    public void doSomething() {
        new Class31().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
