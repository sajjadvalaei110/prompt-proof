package com.example.largeproject.pkg6;

import com.example.largeproject.pkg4.Class40;

public class Class61 {
    public void doSomething() {
        new Class40().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
