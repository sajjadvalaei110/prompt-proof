package com.example.largeproject.pkg4;

import com.example.largeproject.pkg1.Class14;
import com.example.largeproject.pkg9.Class91;
import com.example.largeproject.pkg3.Class37;

public class Class49 {
    public void doSomething() {
        new Class91().process();
        new Class14().process();
        new Class37().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
