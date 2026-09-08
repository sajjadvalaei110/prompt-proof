package com.example.largeproject.pkg6;

import com.example.largeproject.pkg3.Class37;
import com.example.largeproject.pkg2.Class20;
import com.example.largeproject.pkg0.Class5;
import com.example.largeproject.pkg9.Class92;

public class Class60 {
    public void doSomething() {
        new Class92().process();
        new Class5().process();
        new Class20().process();
        new Class65().process();
        new Class37().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
