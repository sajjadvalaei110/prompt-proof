package com.example.largeproject.pkg7;

import com.example.largeproject.pkg8.Class87;
import com.example.largeproject.pkg5.Class53;
import com.example.largeproject.pkg3.Class32;
import com.example.largeproject.pkg4.Class46;

public class Class77 {
    public void doSomething() {
        new Class46().process();
        new Class32().process();
        new Class53().process();
        new Class87().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
