package com.example.largeproject.pkg8;

import com.example.largeproject.pkg4.Class44;
import com.example.largeproject.pkg9.Class94;
import com.example.largeproject.pkg6.Class60;
import com.example.largeproject.pkg4.Class40;

public class Class87 {
    public void doSomething() {
        new Class83().process();
        new Class40().process();
        new Class44().process();
        new Class94().process();
        new Class60().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
