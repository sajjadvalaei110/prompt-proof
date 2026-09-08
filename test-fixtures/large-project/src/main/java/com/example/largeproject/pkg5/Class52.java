package com.example.largeproject.pkg5;

import com.example.largeproject.pkg6.Class69;
import com.example.largeproject.pkg3.Class33;

public class Class52 {
    public void doSomething() {
        new Class33().process();
        new Class69().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
