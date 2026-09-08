package com.example.largeproject.pkg9;

import com.example.largeproject.pkg8.Class82;
import com.example.largeproject.pkg1.Class13;
import com.example.largeproject.pkg3.Class33;

public class Class99 {
    public void doSomething() {
        new Class33().process();
        new Class82().process();
        new Class13().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
