package com.example.largeproject.pkg9;

import com.example.largeproject.pkg8.Class83;
import com.example.largeproject.pkg3.Class39;

public class Class95 {
    public void doSomething() {
        new Class39().process();
        new Class83().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
