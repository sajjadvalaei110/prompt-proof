package com.example.largeproject.pkg6;

import com.example.largeproject.pkg7.Class71;
import com.example.largeproject.pkg9.Class98;
import com.example.largeproject.pkg3.Class38;

public class Class67 {
    public void doSomething() {
        new Class38().process();
        new Class98().process();
        new Class71().process();
        new Class68().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
