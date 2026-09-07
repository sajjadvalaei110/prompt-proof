package com.example.largeproject.pkg1;

import com.example.largeproject.pkg6.Class64;
import com.example.largeproject.pkg4.Class42;

public class Class14 {
    public void doSomething() {
        new Class42().process();
        new Class64().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
