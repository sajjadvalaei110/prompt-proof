package com.example.largeproject.pkg8;

import com.example.largeproject.pkg0.Class7;
import com.example.largeproject.pkg9.Class91;
import com.example.largeproject.pkg0.Class0;

public class Class80 {
    public void doSomething() {
        new Class91().process();
        new Class7().process();
        new Class81().process();
        new Class0().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
