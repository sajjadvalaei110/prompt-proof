package com.example.largeproject.pkg9;

import com.example.largeproject.pkg2.Class29;
import com.example.largeproject.pkg4.Class48;

public class Class94 {
    public void doSomething() {
        new Class48().process();
        new Class29().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
