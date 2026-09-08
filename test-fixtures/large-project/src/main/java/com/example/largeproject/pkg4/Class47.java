package com.example.largeproject.pkg4;

import com.example.largeproject.pkg7.Class76;
import com.example.largeproject.pkg5.Class52;
import com.example.largeproject.pkg5.Class57;
import com.example.largeproject.pkg8.Class88;
import com.example.largeproject.pkg9.Class96;

public class Class47 {
    public void doSomething() {
        new Class96().process();
        new Class52().process();
        new Class88().process();
        new Class57().process();
        new Class76().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
