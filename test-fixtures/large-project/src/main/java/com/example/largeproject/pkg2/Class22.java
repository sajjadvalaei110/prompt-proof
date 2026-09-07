package com.example.largeproject.pkg2;

import com.example.largeproject.pkg8.Class88;
import com.example.largeproject.pkg7.Class72;
import com.example.largeproject.pkg5.Class57;

public class Class22 {
    public void doSomething() {
        new Class57().process();
        new Class88().process();
        new Class72().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
