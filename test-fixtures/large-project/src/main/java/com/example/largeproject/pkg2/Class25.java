package com.example.largeproject.pkg2;

import com.example.largeproject.pkg4.Class48;
import com.example.largeproject.pkg3.Class37;
import com.example.largeproject.pkg5.Class55;
import com.example.largeproject.pkg3.Class38;
import com.example.largeproject.pkg3.Class33;

public class Class25 {
    public void doSomething() {
        new Class38().process();
        new Class55().process();
        new Class37().process();
        new Class48().process();
        new Class33().process();
    }

    public void process() {
        System.out.println("Processing in " + this.getClass().getSimpleName());
    }
}
