package com.example.largeproject.pkg0;

import com.example.largeproject.pkg2.Class26;
import com.example.largeproject.pkg2.Class20;
import com.example.largeproject.pkg5.Class59;

public class Class4 {
    public void doSomething() {
        new Class20().process();
        new Class26().process();
        new Class59().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
