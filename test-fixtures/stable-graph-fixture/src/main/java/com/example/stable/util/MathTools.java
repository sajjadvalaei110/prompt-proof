package com.example.stable.util;

/** Deliberately disconnected: no collaborators, so the map keeps isolated cards. */
public final class MathTools {
    private MathTools() {
    }

    public static int size(String value) {
        return value == null ? 0 : value.length();
    }
}
