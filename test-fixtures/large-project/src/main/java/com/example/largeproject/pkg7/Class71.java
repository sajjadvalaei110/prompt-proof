package com.example.largeproject.pkg7;

import com.example.largeproject.pkg4.Class49;
import com.example.largeproject.pkg0.Class2;

public class Class71 {
    public void doSomething() {
        new Class49().process();
        new Class2().process();
        new Class74().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
