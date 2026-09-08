package com.example.largeproject.pkg3;

import com.example.largeproject.pkg4.Class41;
import com.example.largeproject.pkg6.Class64;

public class Class37 {
    public void doSomething() {
        new Class64().process();
        new Class41().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
