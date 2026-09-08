package com.example.largeproject.pkg7;

import com.example.largeproject.pkg5.Class55;

public class Class73 {
    public void doSomething() {
        new Class55().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
