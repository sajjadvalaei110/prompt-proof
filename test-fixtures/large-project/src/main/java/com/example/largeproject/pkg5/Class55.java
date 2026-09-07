package com.example.largeproject.pkg5;

import com.example.largeproject.pkg8.Class85;
import com.example.largeproject.pkg0.Class7;
import com.example.largeproject.pkg2.Class24;

public class Class55 {
    public void doSomething() {
        new Class24().process();
        new Class85().process();
        new Class7().process();
        new Class56().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
