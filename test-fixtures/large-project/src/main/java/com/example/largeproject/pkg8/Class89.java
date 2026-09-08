package com.example.largeproject.pkg8;

import com.example.largeproject.pkg9.Class90;
import com.example.largeproject.pkg2.Class22;

public class Class89 {
    public void doSomething() {
        new Class22().process();
        new Class90().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
