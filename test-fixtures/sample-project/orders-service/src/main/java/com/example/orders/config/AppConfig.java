package com.example.orders.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;

@Configuration
public class AppConfig {
    
    @Bean
    @Qualifier("paymentGateway")
    public PaymentGateway paymentGateway() {
        return new PaymentGateway();
    }
    
    @Bean
    @Profile("production")
    public Object productionOnlyBean() {
        return new Object();
    }
}
