package com.example.largeproject.pkg0;

import com.example.largeproject.pkg6.Class67;
import com.example.largeproject.pkg3.Class38;
import com.example.largeproject.pkg5.Class50;
import com.example.largeproject.pkg7.Class78;

public class Class6 {
    public void doSomething() {
        new Class67().process();
        new Class50().process();
        new Class78().process();
        new Class9().process();
        new Class38().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
