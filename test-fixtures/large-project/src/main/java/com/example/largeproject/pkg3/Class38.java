package com.example.largeproject.pkg3;

import com.example.largeproject.pkg2.Class29;

public class Class38 {
    public void doSomething() {
        new Class29().process();
        new Class30().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
