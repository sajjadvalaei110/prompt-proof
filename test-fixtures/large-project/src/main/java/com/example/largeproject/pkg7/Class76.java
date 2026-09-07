package com.example.largeproject.pkg7;

import com.example.largeproject.pkg8.Class80;
import com.example.largeproject.pkg9.Class99;

public class Class76 {
    public void doSomething() {
        new Class80().process();
        new Class99().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
