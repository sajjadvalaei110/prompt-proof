package com.example.largeproject.pkg4;

import com.example.largeproject.pkg9.Class99;
import com.example.largeproject.pkg6.Class69;
import com.example.largeproject.pkg7.Class72;
import com.example.largeproject.pkg5.Class51;

public class Class43 {
    public void doSomething() {
        new Class72().process();
        new Class51().process();
        new Class99().process();
        new Class69().process();
        new Class46().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
