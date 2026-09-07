package com.example.largeproject.pkg7;

import com.example.largeproject.pkg3.Class31;
import com.example.largeproject.pkg8.Class81;

public class Class72 {
    public void doSomething() {
        new Class74().process();
        new Class31().process();
        new Class81().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
