package com.example.largeproject.pkg7;

import com.example.largeproject.pkg8.Class85;
import com.example.largeproject.pkg5.Class50;

public class Class74 {
    public void doSomething() {
        new Class85().process();
        new Class50().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
