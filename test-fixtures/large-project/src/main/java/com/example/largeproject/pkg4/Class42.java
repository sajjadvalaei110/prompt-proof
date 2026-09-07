package com.example.largeproject.pkg4;

import com.example.largeproject.pkg2.Class20;
import com.example.largeproject.pkg6.Class64;

public class Class42 {
    public void doSomething() {
        new Class64().process();
        new Class20().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
