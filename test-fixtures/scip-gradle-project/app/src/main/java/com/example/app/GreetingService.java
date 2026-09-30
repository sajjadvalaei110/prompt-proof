package com.example.app;

import com.example.core.FriendlyGreeter;
import com.example.core.Greeter;
import java.util.ArrayList;
import java.util.List;

public class GreetingService {
    private final Greeter greeter = new FriendlyGreeter();

    public List<String> greetAll(List<String> names) {
        List<String> result = new ArrayList<>();
        for (String name : names) {
            result.add(greeter.greet(name));
        }
        return result;
    }
}
