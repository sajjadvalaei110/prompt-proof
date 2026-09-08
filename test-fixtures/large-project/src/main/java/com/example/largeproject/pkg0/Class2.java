package com.example.largeproject.pkg0;

import com.example.largeproject.pkg2.Class23;

public class Class2 {
    public void doSomething() {
        new Class23().process();
        new Class0().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
