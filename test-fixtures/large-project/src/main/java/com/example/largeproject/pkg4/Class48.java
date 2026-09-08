package com.example.largeproject.pkg4;

import com.example.largeproject.pkg0.Class5;
import com.example.largeproject.pkg1.Class10;

public class Class48 {
    public void doSomething() {
        new Class5().process();
        new Class10().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
