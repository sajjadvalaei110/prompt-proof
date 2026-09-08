package com.example.largeproject.pkg2;

import com.example.largeproject.pkg4.Class47;
import com.example.largeproject.pkg7.Class73;
import com.example.largeproject.pkg3.Class36;
import com.example.largeproject.pkg7.Class70;

public class Class23 {
    public void doSomething() {
        new Class73().process();
        new Class70().process();
        new Class47().process();
        new Class36().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
