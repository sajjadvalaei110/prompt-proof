package com.example.largeproject.pkg7;

import com.example.largeproject.pkg6.Class61;
import com.example.largeproject.pkg3.Class35;
import com.example.largeproject.pkg6.Class64;
import com.example.largeproject.pkg1.Class16;
import com.example.largeproject.pkg1.Class18;

public class Class70 {
    public void doSomething() {
        new Class61().process();
        new Class16().process();
        new Class18().process();
        new Class64().process();
        new Class35().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
