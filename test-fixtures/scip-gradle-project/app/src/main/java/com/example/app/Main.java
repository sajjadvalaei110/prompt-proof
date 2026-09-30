package com.example.app;

import com.example.core.Greeting;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        GreetingService service = new GreetingService();
        List<String> lines = service.greetAll(List.of(args));
        lines.forEach(System.out::println);
        Greeting greeting = new Greeting.Builder().build();
        System.out.println(greeting.greet("world"));
    }
}
