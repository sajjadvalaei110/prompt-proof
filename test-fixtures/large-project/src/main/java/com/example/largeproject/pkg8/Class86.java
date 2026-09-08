package com.example.largeproject.pkg8;

import com.example.largeproject.pkg5.Class52;
import com.example.largeproject.pkg2.Class21;

public class Class86 {
    public void doSomething() {
        new Class21().process();
        new Class80().process();
        new Class52().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
