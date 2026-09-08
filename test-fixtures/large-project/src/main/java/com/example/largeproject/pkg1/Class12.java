package com.example.largeproject.pkg1;

import com.example.largeproject.pkg0.Class7;
import com.example.largeproject.pkg3.Class36;
import com.example.largeproject.pkg8.Class83;
import com.example.largeproject.pkg7.Class75;
import com.example.largeproject.pkg6.Class60;

public class Class12 {
    public void doSomething() {
        new Class7().process();
        new Class75().process();
        new Class60().process();
        new Class36().process();
        new Class83().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
