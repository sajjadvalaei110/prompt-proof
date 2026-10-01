package com.example.app;

import com.example.core.Greeter;
import java.util.function.Supplier;

/** Constructor expressions whose tokens are split across lines, comments and qualifiers. */
public class Factories {
    GreetingService plain() {
        return new
            GreetingService();
    }

    GreetingService commented() {
        return new // a line comment
            /* and a block comment */ GreetingService();
    }

    Greeter qualified() {
        return new com.example
            .core.FriendlyGreeter();
    }

    Supplier<GreetingService> reference() {
        return GreetingService
            ::new;
    }
}
