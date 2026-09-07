package com.example.largeproject.pkg3;

import com.example.largeproject.pkg1.Class13;
import com.example.largeproject.pkg9.Class96;

public class Class32 {
    public void doSomething() {
        new Class13().process();
        new Class96().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
