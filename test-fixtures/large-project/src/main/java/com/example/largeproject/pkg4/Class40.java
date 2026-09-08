package com.example.largeproject.pkg4;

import com.example.largeproject.pkg0.Class3;
import com.example.largeproject.pkg5.Class53;
import com.example.largeproject.pkg3.Class34;
import com.example.largeproject.pkg1.Class10;

public class Class40 {
    public void doSomething() {
        new Class3().process();
        new Class53().process();
        new Class34().process();
        new Class10().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
