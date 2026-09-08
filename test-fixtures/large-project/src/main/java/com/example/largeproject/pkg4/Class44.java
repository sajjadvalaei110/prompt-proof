package com.example.largeproject.pkg4;

import com.example.largeproject.pkg5.Class56;
import com.example.largeproject.pkg2.Class23;

public class Class44 {
    public void doSomething() {
        new Class23().process();
        new Class56().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
