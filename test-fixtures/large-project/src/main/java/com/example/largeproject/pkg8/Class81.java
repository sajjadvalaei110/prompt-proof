package com.example.largeproject.pkg8;

import com.example.largeproject.pkg1.Class19;
import com.example.largeproject.pkg1.Class13;
import com.example.largeproject.pkg7.Class77;
import com.example.largeproject.pkg4.Class49;
import com.example.largeproject.pkg2.Class26;

public class Class81 {
    public void doSomething() {
        new Class26().process();
        new Class77().process();
        new Class49().process();
        new Class13().process();
        new Class19().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
