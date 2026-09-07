package com.example.largeproject.pkg1;

import com.example.largeproject.pkg9.Class94;
import com.example.largeproject.pkg2.Class27;
import com.example.largeproject.pkg2.Class28;
import com.example.largeproject.pkg7.Class78;

public class Class17 {
    public void doSomething() {
        new Class94().process();
        new Class78().process();
        new Class28().process();
        new Class27().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
