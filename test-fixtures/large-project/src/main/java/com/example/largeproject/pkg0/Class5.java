package com.example.largeproject.pkg0;

import com.example.largeproject.pkg1.Class14;

public class Class5 {
    public void doSomething() {
        new Class14().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
