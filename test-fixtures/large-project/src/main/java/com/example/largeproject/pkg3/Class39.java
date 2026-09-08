package com.example.largeproject.pkg3;

import com.example.largeproject.pkg6.Class64;
import com.example.largeproject.pkg8.Class86;

public class Class39 {
    public void doSomething() {
        new Class64().process();
        new Class86().process();
        new Class31().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
