package com.example.spring.service;

import com.example.spring.config.EmailSender;
import com.example.spring.model.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class NotificationService {
    
    @Autowired
    private EmailSender emailSender;
    
    public void notifyUser(User user) {
        emailSender.send(user.getEmail(), "Welcome");
    }
}
