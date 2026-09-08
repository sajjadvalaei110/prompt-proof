package com.example.largeproject.pkg6;

import com.example.largeproject.pkg8.Class80;
import com.example.largeproject.pkg8.Class89;

public class Class65 {
    public void doSomething() {
        new Class80().process();
        new Class89().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
