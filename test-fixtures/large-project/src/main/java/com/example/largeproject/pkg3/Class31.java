package com.example.largeproject.pkg3;

import com.example.largeproject.pkg9.Class94;
import com.example.largeproject.pkg0.Class9;

public class Class31 {
    public void doSomething() {
        new Class30().process();
        new Class94().process();
        new Class9().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
