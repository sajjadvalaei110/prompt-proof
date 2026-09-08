package com.example.largeproject.pkg1;

import com.example.largeproject.pkg0.Class0;
import com.example.largeproject.pkg5.Class53;
import com.example.largeproject.pkg6.Class68;
import com.example.largeproject.pkg9.Class95;
import com.example.largeproject.pkg8.Class82;

public class Class15 {
    public void doSomething() {
        new Class68().process();
        new Class95().process();
        new Class82().process();
        new Class53().process();
        new Class0().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
