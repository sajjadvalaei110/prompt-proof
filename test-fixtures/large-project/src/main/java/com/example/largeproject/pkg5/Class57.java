package com.example.largeproject.pkg5;

import com.example.largeproject.pkg4.Class49;
import com.example.largeproject.pkg3.Class37;
import com.example.largeproject.pkg3.Class31;

public class Class57 {
    public void doSomething() {
        new Class49().process();
        new Class37().process();
        new Class31().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
