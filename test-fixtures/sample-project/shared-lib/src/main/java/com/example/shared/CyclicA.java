package com.example.shared;

public class CyclicA {
    private CyclicB b;
    
    public CyclicA(CyclicB b) {
        this.b = b;
    }
}
