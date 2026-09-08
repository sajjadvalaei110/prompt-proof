package com.example.spring.repository;

import com.example.spring.model.User;
import org.springframework.stereotype.Repository;
import java.util.ArrayList;
import java.util.List;

@Repository
public class UserRepositoryImpl implements UserRepository {
    @Override
    public List<User> findAll() { return new ArrayList<>(); }
    @Override
    public User findById(Long id) { return new User(); }
    @Override
    public User save(User user) { return user; }
    @Override
    public void deleteById(Long id) {}
}
