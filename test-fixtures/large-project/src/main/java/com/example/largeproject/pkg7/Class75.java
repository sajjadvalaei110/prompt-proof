package com.example.largeproject.pkg7;

import com.example.largeproject.pkg1.Class16;
import com.example.largeproject.pkg9.Class96;
import com.example.largeproject.pkg4.Class42;

public class Class75 {
    public void doSomething() {
        new Class16().process();
        new Class42().process();
        new Class96().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
