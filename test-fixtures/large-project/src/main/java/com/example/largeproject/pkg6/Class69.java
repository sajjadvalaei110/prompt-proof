package com.example.largeproject.pkg6;

import com.example.largeproject.pkg8.Class88;
import com.example.largeproject.pkg2.Class28;
import com.example.largeproject.pkg3.Class30;
import com.example.largeproject.pkg1.Class17;

public class Class69 {
    public void doSomething() {
        new Class30().process();
        new Class17().process();
        new Class28().process();
        new Class88().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
