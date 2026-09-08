package com.example.largeproject.pkg5;

import com.example.largeproject.pkg1.Class16;
import com.example.largeproject.pkg3.Class33;

public class Class59 {
    public void doSomething() {
        new Class16().process();
        new Class33().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
