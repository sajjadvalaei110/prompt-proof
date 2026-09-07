package com.example.largeproject.pkg8;

import com.example.largeproject.pkg2.Class26;
import com.example.largeproject.pkg7.Class70;

public class Class85 {
    public void doSomething() {
        new Class70().process();
        new Class26().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
