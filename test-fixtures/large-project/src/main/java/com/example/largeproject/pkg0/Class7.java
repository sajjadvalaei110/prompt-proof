package com.example.largeproject.pkg0;

import com.example.largeproject.pkg8.Class85;
import com.example.largeproject.pkg7.Class73;

public class Class7 {
    public void doSomething() {
        new Class73().process();
        new Class85().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
