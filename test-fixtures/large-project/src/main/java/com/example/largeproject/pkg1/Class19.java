package com.example.largeproject.pkg1;

import com.example.largeproject.pkg6.Class65;
import com.example.largeproject.pkg6.Class64;
import com.example.largeproject.pkg3.Class39;
import com.example.largeproject.pkg4.Class45;

public class Class19 {
    public void doSomething() {
        new Class65().process();
        new Class64().process();
        new Class45().process();
        new Class39().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
