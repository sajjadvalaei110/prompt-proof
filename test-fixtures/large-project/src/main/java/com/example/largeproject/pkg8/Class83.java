package com.example.largeproject.pkg8;

import com.example.largeproject.pkg4.Class47;
import com.example.largeproject.pkg9.Class93;
import com.example.largeproject.pkg5.Class52;
import com.example.largeproject.pkg9.Class97;

public class Class83 {
    public void doSomething() {
        new Class52().process();
        new Class47().process();
        new Class93().process();
        new Class97().process();
        new Class86().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
