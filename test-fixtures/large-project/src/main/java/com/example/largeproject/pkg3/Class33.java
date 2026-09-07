package com.example.largeproject.pkg3;

import com.example.largeproject.pkg7.Class71;
import com.example.largeproject.pkg7.Class77;
import com.example.largeproject.pkg0.Class4;
import com.example.largeproject.pkg1.Class18;
import com.example.largeproject.pkg4.Class45;

public class Class33 {
    public void doSomething() {
        new Class45().process();
        new Class77().process();
        new Class18().process();
        new Class71().process();
        new Class4().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
