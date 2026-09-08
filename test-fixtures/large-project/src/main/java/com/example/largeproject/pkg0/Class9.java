package com.example.largeproject.pkg0;

import com.example.largeproject.pkg8.Class85;
import com.example.largeproject.pkg6.Class62;
import com.example.largeproject.pkg3.Class34;
import com.example.largeproject.pkg1.Class17;

public class Class9 {
    public void doSomething() {
        new Class17().process();
        new Class85().process();
        new Class62().process();
        new Class34().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
