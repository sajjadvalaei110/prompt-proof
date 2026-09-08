package com.example.largeproject.pkg1;

import com.example.largeproject.pkg7.Class75;
import com.example.largeproject.pkg6.Class62;
import com.example.largeproject.pkg4.Class42;
import com.example.largeproject.pkg2.Class25;

public class Class18 {
    public void doSomething() {
        new Class25().process();
        new Class42().process();
        new Class62().process();
        new Class75().process();
        new Class14().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
