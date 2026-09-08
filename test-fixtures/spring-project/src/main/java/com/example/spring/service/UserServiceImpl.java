package com.example.spring.service;

import com.example.spring.model.User;
import com.example.spring.repository.UserRepository;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class UserServiceImpl implements UserService {
    private final UserRepository userRepository;
    private final NotificationService notificationService;

    public UserServiceImpl(UserRepository userRepository, NotificationService notificationService) {
        this.userRepository = userRepository;
        this.notificationService = notificationService;
    }

    @Override
    public List<User> findAll() { return userRepository.findAll(); }
    @Override
    public User findById(Long id) { return userRepository.findById(id); }
    @Override
    public User create(User user) {
        User saved = userRepository.save(user);
        notificationService.notifyUser(saved);
        return saved;
    }
    @Override
    public User update(Long id, User user) { return userRepository.save(user); }
    @Override
    public void delete(Long id) { userRepository.deleteById(id); }
}
