package com.example.largeproject.pkg9;

import com.example.largeproject.pkg6.Class61;

public class Class93 {
    public void doSomething() {
        new Class61().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
