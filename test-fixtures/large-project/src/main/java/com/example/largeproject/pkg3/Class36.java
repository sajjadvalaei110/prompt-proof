package com.example.largeproject.pkg3;

import com.example.largeproject.pkg8.Class85;
import com.example.largeproject.pkg9.Class93;

public class Class36 {
    public void doSomething() {
        new Class85().process();
        new Class31().process();
        new Class93().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
