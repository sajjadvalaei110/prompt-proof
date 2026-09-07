package com.example.largeproject.pkg6;

import com.example.largeproject.pkg9.Class91;

public class Class63 {
    public void doSomething() {
        new Class91().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
