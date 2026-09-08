package com.example.largeproject.pkg9;

import com.example.largeproject.pkg5.Class56;
import com.example.largeproject.pkg0.Class7;

public class Class98 {
    public void doSomething() {
        new Class56().process();
        new Class7().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
