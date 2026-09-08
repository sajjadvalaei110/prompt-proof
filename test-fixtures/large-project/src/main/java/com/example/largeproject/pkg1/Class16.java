package com.example.largeproject.pkg1;

import com.example.largeproject.pkg5.Class53;
import com.example.largeproject.pkg2.Class20;
import com.example.largeproject.pkg6.Class60;

public class Class16 {
    public void doSomething() {
        new Class53().process();
        new Class60().process();
        new Class13().process();
        new Class20().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
