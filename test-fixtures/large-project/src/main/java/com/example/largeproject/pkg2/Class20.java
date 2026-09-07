package com.example.largeproject.pkg2;

import com.example.largeproject.pkg6.Class63;
import com.example.largeproject.pkg8.Class81;

public class Class20 {
    public void doSomething() {
        new Class81().process();
        new Class63().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
