package com.example.largeproject.pkg7;

import com.example.largeproject.pkg6.Class62;
import com.example.largeproject.pkg6.Class64;
import com.example.largeproject.pkg8.Class88;

public class Class78 {
    public void doSomething() {
        new Class62().process();
        new Class88().process();
        new Class64().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
