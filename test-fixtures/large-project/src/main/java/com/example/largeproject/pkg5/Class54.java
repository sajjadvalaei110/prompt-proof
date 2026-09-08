package com.example.largeproject.pkg5;

import com.example.largeproject.pkg1.Class13;
import com.example.largeproject.pkg2.Class27;
import com.example.largeproject.pkg8.Class87;
import com.example.largeproject.pkg1.Class18;
import com.example.largeproject.pkg3.Class38;

public class Class54 {
    public void doSomething() {
        new Class38().process();
        new Class27().process();
        new Class18().process();
        new Class13().process();
        new Class87().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
