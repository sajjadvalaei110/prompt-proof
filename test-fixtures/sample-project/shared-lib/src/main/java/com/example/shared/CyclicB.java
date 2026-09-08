package com.example.shared;

public class CyclicB {
    private CyclicA a;
    
    public CyclicB(CyclicA a) {
        this.a = a;
    }
}
