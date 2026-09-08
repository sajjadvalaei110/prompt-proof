package com.example.largeproject.pkg5;

import com.example.largeproject.pkg3.Class33;
import com.example.largeproject.pkg2.Class23;

public class Class56 {
    public void doSomething() {
        new Class33().process();
        new Class23().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
