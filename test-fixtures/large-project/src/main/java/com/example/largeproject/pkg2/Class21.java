package com.example.largeproject.pkg2;

import com.example.largeproject.pkg4.Class49;
import com.example.largeproject.pkg5.Class53;
import com.example.largeproject.pkg8.Class87;
import com.example.largeproject.pkg3.Class35;
import com.example.largeproject.pkg4.Class46;

public class Class21 {
    public void doSomething() {
        new Class46().process();
        new Class87().process();
        new Class35().process();
        new Class53().process();
        new Class49().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
