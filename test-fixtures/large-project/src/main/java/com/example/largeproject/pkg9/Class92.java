package com.example.largeproject.pkg9;

import com.example.largeproject.pkg2.Class20;
import com.example.largeproject.pkg2.Class27;
import com.example.largeproject.pkg0.Class6;

public class Class92 {
    public void doSomething() {
        new Class27().process();
        new Class6().process();
        new Class20().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
