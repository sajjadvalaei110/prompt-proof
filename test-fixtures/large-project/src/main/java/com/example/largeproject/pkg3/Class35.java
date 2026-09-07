package com.example.largeproject.pkg3;

import com.example.largeproject.pkg8.Class87;
import com.example.largeproject.pkg0.Class4;
import com.example.largeproject.pkg6.Class62;
import com.example.largeproject.pkg8.Class86;

public class Class35 {
    public void doSomething() {
        new Class4().process();
        new Class86().process();
        new Class62().process();
        new Class87().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
