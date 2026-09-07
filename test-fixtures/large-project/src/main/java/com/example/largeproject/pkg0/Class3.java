package com.example.largeproject.pkg0;

import com.example.largeproject.pkg6.Class60;
import com.example.largeproject.pkg5.Class58;
import com.example.largeproject.pkg1.Class15;
import com.example.largeproject.pkg3.Class39;

public class Class3 {
    public void doSomething() {
        new Class39().process();
        new Class58().process();
        new Class60().process();
        new Class15().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
