package com.example.spring.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;

@Configuration
public class AppConfig {
    
    @Bean
    public EmailSender emailSender() {
        return new EmailSender();
    }
    
    @Bean
    @Qualifier("customSender")
    public EmailSender customEmailSender() {
        return new EmailSender();
    }
}
