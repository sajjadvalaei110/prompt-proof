package com.example.largeproject.pkg5;

import com.example.largeproject.pkg1.Class14;
import com.example.largeproject.pkg3.Class34;
import com.example.largeproject.pkg0.Class9;

public class Class51 {
    public void doSomething() {
        new Class58().process();
        new Class9().process();
        new Class14().process();
        new Class34().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
